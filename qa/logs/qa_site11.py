#!/usr/bin/env python3
"""QA renders, Chrome request capture, spike measurements for voxloom-site #11."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import itertools
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import websockets
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

OUT = Path("/workspace/qa-ui/site11/85da191")
RENDERS = OUT / "renders"
LOGS = OUT / "logs"
MAIN_PUB = Path("/tmp/qa-site11/main/public")
PR_PUB = Path("/tmp/qa-site11/src/public")
CHROME = "/usr/bin/google-chrome"
RSVG = "/workspace/tools/mamba/envs/vxbuild2/bin/rsvg-convert"
KYLE_JPG = Path("/workspace/qa-ui/voxloom-site-favicon/kyle-ios-tabs-dark-edge.jpg")
WEBDEV = Path("/workspace/qa-ui/voxloom-site-favicon/brave-fix")

LIGHT = (0xF2, 0xF2, 0xF7)
WHITE = (0xFF, 0xFF, 0xFF)
DARK = (0x29, 0x2A, 0x2D)
# iOS dark tab-grid-ish backgrounds
IOS_BLACK = (0, 0, 0)
IOS_TAB = (0x1C, 0x1C, 0x1E)
BRAVE_TAB = (28, 28, 28)  # Web Dev's #1c1c1c

SPIKE_DELTA = 20  # luminance darker than background

ICON_NAMES = (
    "favicon.ico",
    "favicon.svg",
    "icon-192.png",
    "icon-512.png",
    "apple-touch-icon.png",
    "manifest.webmanifest",
)


def lum(rgb):
    r, g, b = rgb[:3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def max_diff(a: Image.Image, b: Image.Image) -> int:
    if a.size != b.size or a.mode != b.mode:
        return 255
    d = ImageChops.difference(a, b)
    return max(d.getextrema()[ch][1] for ch in range(len(d.getbands())))


def pixel_diff_count(a: Image.Image, b: Image.Image) -> int:
    if a.size != b.size:
        return a.size[0] * a.size[1]
    a, b = a.convert("RGB"), b.convert("RGB")
    da, db = a.tobytes(), b.tobytes()
    w, h = a.size
    n = 0
    for i in range(0, len(da), 3):
        if da[i : i + 3] != db[i : i + 3]:
            n += 1
    return n


def font(size: int):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def font_bold(size: int):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return font(size)


def zoom(im: Image.Image, factor: int = 8) -> Image.Image:
    return im.resize((im.width * factor, im.height * factor), Image.Resampling.NEAREST)


def rsvg(src: Path, size: int) -> Image.Image:
    data = subprocess.check_output(
        [RSVG, "-w", str(size), "-h", str(size), "-b", "none", str(src)]
    )
    return Image.open(io.BytesIO(data)).convert("RGBA")


def cairosvg_raster(src: Path, size: int) -> Image.Image:
    import cairosvg

    data = cairosvg.svg2png(url=str(src), output_width=size, output_height=size)
    return Image.open(io.BytesIO(data)).convert("RGBA")


def load_ico_frame(src: Path, size: int) -> Image.Image:
    im = Image.open(src)
    frames = []
    i = 0
    while True:
        try:
            im.seek(i)
            frames.append(im.copy().convert("RGBA"))
            i += 1
        except EOFError:
            break
    exact = [f for f in frames if f.size == (size, size)]
    if exact:
        return exact[0]
    # closest then resize
    best = min(frames, key=lambda f: abs(f.size[0] - size))
    if best.size != (size, size):
        return best.resize((size, size), Image.Resampling.LANCZOS)
    return best


def load_png(src: Path, size: int) -> Image.Image:
    im = Image.open(src).convert("RGBA")
    if im.size != (size, size):
        im = im.resize((size, size), Image.Resampling.LANCZOS)
    return im


def render_icon(path: Path, pixel: int) -> Image.Image:
    suf = path.suffix.lower()
    if suf == ".svg":
        return rsvg(path, pixel)
    if suf == ".ico":
        return load_ico_frame(path, pixel)
    return load_png(path, pixel)


def composite_on(icon: Image.Image, bg, pixel: int) -> Image.Image:
    canvas = Image.new("RGBA", (pixel, pixel), bg + (255,))
    if icon.size != (pixel, pixel):
        icon = icon.resize((pixel, pixel), Image.Resampling.LANCZOS)
    if icon.mode != "RGBA":
        icon = icon.convert("RGBA")
    return Image.alpha_composite(canvas, icon).convert("RGB")


def flatten_on_black(icon: Image.Image, pixel: int) -> Image.Image:
    """Old iOS behavior: transparent corners flattened onto black, then used as opaque icon."""
    return composite_on(icon, (0, 0, 0), pixel)


def corners_of(im: Image.Image):
    px = im.load()
    w, h = im.size
    return {
        "tl": list(px[0, 0][:3]),
        "tr": list(px[w - 1, 0][:3]),
        "bl": list(px[0, h - 1][:3]),
        "br": list(px[w - 1, h - 1][:3]),
        "midtop": list(px[w // 2, 0][:3]),
    }


def spike_report(im: Image.Image, bg):
    c = corners_of(im)
    bg_l = lum(bg)
    out = {}
    any_spike = False
    for name, rgb in c.items():
        if name == "midtop":
            continue
        dl = lum(rgb) - bg_l
        spike = dl <= -SPIKE_DELTA
        any_spike = any_spike or spike
        out[name] = {
            "rgb": rgb,
            "lum": round(lum(rgb), 2),
            "dL_vs_bg": round(dl, 2),
            "spike": spike,
        }
    out["any_spike"] = any_spike
    out["bg"] = list(bg)
    out["bg_lum"] = round(bg_l, 2)
    return out


# ---------------- HTTP server with access log ----------------
class LoggingHandler(SimpleHTTPRequestHandler):
    log_list = None  # set on subclass
    log_lock = None
    label = ""

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        # manifest content-type like vercel.json
        if self.path.split("?")[0].endswith(".webmanifest"):
            self.send_header("Content-Type", "application/manifest+json; charset=utf-8")
        super().end_headers()

    def do_GET(self):
        rec = {
            "t": time.time(),
            "label": self.label,
            "method": "GET",
            "path": self.path,
            "ua": self.headers.get("User-Agent", ""),
            "referer": self.headers.get("Referer", ""),
        }
        self.log_lock.acquire()
        try:
            self.log_list.append(rec)
        finally:
            self.log_lock.release()
        return super().do_GET()

    def do_HEAD(self):
        rec = {
            "t": time.time(),
            "label": self.label,
            "method": "HEAD",
            "path": self.path,
            "ua": self.headers.get("User-Agent", ""),
            "referer": self.headers.get("Referer", ""),
        }
        self.log_lock.acquire()
        try:
            self.log_list.append(rec)
        finally:
            self.log_lock.release()
        return super().do_HEAD()


def serve(root: Path, port: int, label: str, log_list, log_lock) -> ThreadingHTTPServer:
    handler = type(
        "H",
        (LoggingHandler,),
        {
            "directory": str(root),
            "log_list": log_list,
            "log_lock": log_lock,
            "label": label,
        },
    )
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def find_free(port=0):
    with socket.socket() as s:
        s.bind(("127.0.0.1", port))
        return s.getsockname()[1]


# ---------------- CDP ----------------
class CDP:
    def __init__(self, url: str):
        self.url = url
        self._id = itertools.count(1)
        self.pending = {}
        self.events = []
        self.ws = None

    async def connect(self):
        self.ws = await websockets.connect(self.url, max_size=None)
        asyncio.create_task(self._reader())

    async def _reader(self):
        async for raw in self.ws:
            msg = json.loads(raw)
            if "id" in msg and msg["id"] in self.pending:
                fut = self.pending.pop(msg["id"])
                if "error" in msg:
                    fut.set_exception(RuntimeError(json.dumps(msg["error"])))
                else:
                    fut.set_result(msg.get("result", {}))
            else:
                self.events.append(msg)

    async def call(self, method, **params):
        mid = next(self._id)
        loop = asyncio.get_event_loop()
        fut = loop.create_future()
        self.pending[mid] = fut
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        return await asyncio.wait_for(fut, timeout=25)


async def chrome_session(debug_port: int, profile: Path):
    if profile.exists():
        shutil.rmtree(profile)
    profile.mkdir()
    cmd = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-extensions",
        "--hide-scrollbars",
        f"--remote-debugging-port={debug_port}",
        f"--user-data-dir={str(profile)}",
        "about:blank",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    version = None
    for _ in range(80):
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{debug_port}/json/version", timeout=0.3
            ) as r:
                version = json.load(r)
                break
        except Exception:
            time.sleep(0.1)
    if not version:
        proc.kill()
        raise RuntimeError("Chrome did not open the debugging port")
    return proc, version["webSocketDebuggerUrl"]


async def inspect_pages(browser_ws: str, base: str, pages: list[str], label: str, wait_s: float = 4.0):
    browser = CDP(browser_ws)
    await browser.connect()
    results = []
    for page in pages:
        page_url = f"{base}/{page}"
        target = await browser.call("Target.createTarget", url="about:blank")
        session_id = (
            await browser.call(
                "Target.attachToTarget", targetId=target["targetId"], flatten=True
            )
        )["sessionId"]

        async def session_call(method, **params):
            mid = next(browser._id)
            loop = asyncio.get_event_loop()
            fut = loop.create_future()
            browser.pending[mid] = fut
            payload = {
                "id": mid,
                "method": method,
                "params": params,
                "sessionId": session_id,
            }
            await browser.ws.send(json.dumps(payload))
            return await asyncio.wait_for(fut, timeout=25)

        # clear events for this page (keep a start index)
        start = len(browser.events)
        await session_call("Network.enable")
        await session_call("Network.setCacheDisabled", cacheDisabled=True)
        await session_call("Page.enable")
        await session_call("Page.navigate", url=page_url)
        await asyncio.sleep(wait_s)

        requests = []
        for ev in browser.events[start:]:
            method = ev.get("method")
            params = ev.get("params", {})
            if method == "Network.requestWillBeSent":
                u = params.get("request", {}).get("url", "")
                typ = params.get("type") or params.get("resourceType") or ""
                if u and u not in [r["url"] for r in requests]:
                    requests.append({"url": u, "type": typ, "method": params.get("request", {}).get("method")})

        icon_hits = [
            r["url"]
            for r in requests
            if any(name in r["url"] for name in ICON_NAMES)
        ]

        try:
            links = await session_call(
                "Runtime.evaluate",
                expression="""JSON.stringify([...document.querySelectorAll('link[rel]')].map(l => ({rel:l.rel, href:l.href, type:l.type, sizes:l.sizes && l.sizes.value})))""",
                returnByValue=True,
            )
            link_list = json.loads(links.get("result", {}).get("value") or "[]")
        except Exception as exc:
            link_list = [f"error: {exc}"]

        captured = {}
        # Try chrome://favicon2 — expected to be a placeholder in headless
        for size, scale in ((16, "1x"), (16, "2x"), (32, "1x"), (32, "2x")):
            fav_url = (
                "chrome://favicon2/?size={size}&scale_factor={scale}"
                "&page_url={page}&allow_google_server_fallback=0"
            ).format(size=size, scale=scale, page=urllib.parse.quote(page_url, safe=""))
            try:
                await session_call("Page.navigate", url=fav_url)
                await asyncio.sleep(0.5)
                shot = await session_call(
                    "Page.captureScreenshot", format="png", fromSurface=True
                )
                im = Image.open(io.BytesIO(base64.b64decode(shot["data"]))).convert("RGB")
                captured[f"{size}@{scale}"] = im
            except Exception as exc:
                captured[f"{size}@{scale}"] = f"error: {exc}"

        try:
            await browser.call("Target.closeTarget", targetId=target["targetId"])
        except Exception:
            pass

        results.append(
            {
                "label": label,
                "page": page_url,
                "requests": requests,
                "icon_hits": icon_hits,
                "links": link_list,
                "captured": captured,
            }
        )
    return results


def crop_icon(im: Image.Image, pixel: int) -> Image.Image:
    w, h = im.size

    def is_bg(p):
        return p[0] > 250 and p[1] > 250 and p[2] > 250

    px = im.load()
    xs, ys = [], []
    for y in range(min(h, 400)):
        for x in range(min(w, 400)):
            if not is_bg(px[x, y]):
                xs.append(x)
                ys.append(y)
    if not xs:
        return im.crop((0, 0, min(pixel, w), min(pixel, h)))
    x0, y0 = min(xs), min(ys)
    return im.crop((x0, y0, min(x0 + pixel, w), min(y0 + pixel, h)))


def labeled_grid(cells, title, footer=None):
    """cells: list of (image, caption) already zoomed or not."""
    fb = font_bold(22)
    f = font(14)
    pad = 16
    # normalize
    zooms = []
    for im, cap in cells:
        z = zoom(im, 8) if im.width <= 96 else im
        zooms.append((z, cap))
    col_w = max(z.width for z, _ in zooms) + 8
    row_h = max(z.height for z, _ in zooms) + 40
    # 6 columns if many, else auto
    cols = min(6, len(zooms)) if len(zooms) > 3 else len(zooms)
    rows = (len(zooms) + cols - 1) // cols
    title_h = 48
    foot_h = 36 if footer else 12
    W = pad * 2 + cols * (col_w + pad)
    H = title_h + rows * (row_h + pad) + foot_h
    canvas = Image.new("RGB", (W, H), (24, 24, 28))
    draw = ImageDraw.Draw(canvas)
    draw.text((pad, 12), title, fill=(235, 235, 235), font=fb)
    for i, (z, cap) in enumerate(zooms):
        r, c = divmod(i, cols)
        x = pad + c * (col_w + pad)
        y = title_h + r * (row_h + pad)
        draw.text((x, y), cap, fill=(190, 190, 200), font=f)
        border = ImageOps.expand(z, border=1, fill=(90, 90, 100))
        canvas.paste(border, (x, y + 20))
    if footer:
        draw.text((pad, H - 28), footer, fill=(160, 160, 170), font=font(13))
    return canvas


def place_on_grid(icon: Image.Image, bg, pad=12, cell=None):
    """Place icon on a larger dark tab-grid background."""
    if cell is None:
        cell = icon.width + pad * 2
    canvas = Image.new("RGB", (cell, cell), bg)
    x = (cell - icon.width) // 2
    y = (cell - icon.height) // 2
    if icon.mode == "RGBA":
        tmp = Image.new("RGBA", canvas.size, bg + (255,))
        tmp.paste(icon, (x, y), icon)
        return tmp.convert("RGB")
    canvas.paste(icon, (x, y))
    return canvas


def crop_kyle_favicon(jpg_path: Path):
    """Try to locate the Voxloom tab favicon in Kyle's screenshot."""
    im = Image.open(jpg_path).convert("RGB")
    # Heuristic: the first tab card is top-left; the favicon sits in the title bar
    # of that card. Web Dev already extracted a 48px crop; we also search.
    # We'll scan the upper-left card title row for a small dark-tile icon.
    w, h = im.size
    # Save a loose crop of the top area for evidence
    top = im.crop((0, 0, w, min(h, int(h * 0.55))))
    return im, top


def find_voxloom_icon_in_kyle(im: Image.Image):
    """Search for a ~square dark tile near the top of the left tab card."""
    # Based on typical iOS tab switcher layout and the screenshot description,
    # scan a band under the search bar on the left card.
    w, h = im.size
    px = im.load()
    # Look for a compact dark-violet tile (icon body ~ midtop (35,33,44) in webdev crop)
    # We'll try several candidate sizes around 40-60 px in the top 30%.
    best = None
    # Use a simpler approach: look at webdev crop later; here scan for
    # a region whose mid-top is around (35,33,44) and corners near black.
    # Iterate y from 80 to 400, x from 20 to w//2, window 40-64.
    for size in (48, 44, 52, 40, 56, 36, 32):
        for y in range(40, min(h // 2, 700), 2):
            for x in range(10, min(w // 2, 700), 2):
                if x + size > w or y + size > h:
                    continue
                # mid-top-ish and corner darkness
                mt = px[x + size // 2, y]
                tl = px[x, y]
                # mid-top of the actual icon (not black frame) might be inward
                if lum(tl) > 30:
                    continue
                if not (20 < mt[0] < 80 or lum(mt) < 20):
                    # maybe midtop of window is the black frame; try inward
                    pass
                # check there's a bright-ish bar (green/white) later inside? skip
                # score: variance inside vs dark corners
                corners = [px[x, y], px[x + size - 1, y], px[x, y + size - 1], px[x + size - 1, y + size - 1]]
                if not all(lum(c) < 25 for c in corners):
                    continue
                inner = px[x + size // 2, y + size // 2]
                if lum(inner) < 15:
                    continue
                # prefer presence of green-ish or light bar pixels
                greens = 0
                lights = 0
                for yy in range(y, y + size, 2):
                    for xx in range(x, x + size, 2):
                        p = px[xx, yy]
                        if p[1] > p[0] + 25 and p[1] > 80:
                            greens += 1
                        if lum(p) > 140:
                            lights += 1
                score = greens * 3 + lights
                if score > 8:
                    cand = (score, x, y, size)
                    if best is None or cand[0] > best[0]:
                        best = cand
    if best:
        _, x, y, size = best
        return im.crop((x, y, x + size, y + size)), (x, y, size)
    return None, None


async def main():
    RENDERS.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)

    # ---------- Direct desktop tab renders ----------
    backgrounds = [("light", LIGHT), ("white", WHITE), ("dark", DARK)]
    sources = {
        "main-svg": MAIN_PUB / "favicon.svg",
        "pr-svg": PR_PUB / "favicon.svg",
        "main-ico": MAIN_PUB / "favicon.ico",
        "pr-ico": PR_PUB / "favicon.ico",
        "pr-192": PR_PUB / "icon-192.png",
    }

    analysis = {
        "spike_rule": "exact corner pixel luminance >= 20 darker than background",
        "luminance": "0.2126R+0.7152G+0.0722B",
        "cells": [],
        "pixel_diffs": [],
        "identical_main_pr_svg_ico": True,
        "spike_counts": {},
    }

    rendered = {}  # key -> Image
    for css in (16, 32):
        for dpr in (1, 2):
            pixel = css * dpr
            for bg_name, bg in backgrounds:
                for kind in ("svg", "ico"):
                    main_im = composite_on(render_icon(sources[f"main-{kind}"], pixel), bg, pixel)
                    pr_im = composite_on(render_icon(sources[f"pr-{kind}"], pixel), bg, pixel)
                    k_main = f"main-{kind}-{css}css-dpr{dpr}-{bg_name}"
                    k_pr = f"pr-{kind}-{css}css-dpr{dpr}-{bg_name}"
                    rendered[k_main] = main_im
                    rendered[k_pr] = pr_im
                    main_im.save(RENDERS / f"{k_main}.png")
                    pr_im.save(RENDERS / f"{k_pr}.png")
                    zoom(main_im, 8).save(RENDERS / f"{k_main}-8x.png")
                    zoom(pr_im, 8).save(RENDERS / f"{k_pr}-8x.png")
                    ndiff = pixel_diff_count(main_im, pr_im)
                    md = max_diff(main_im, pr_im)
                    if ndiff or md:
                        analysis["identical_main_pr_svg_ico"] = False
                    sp_main = spike_report(main_im, bg)
                    sp_pr = spike_report(pr_im, bg)
                    rec = {
                        "css": css,
                        "dpr": dpr,
                        "pixel": pixel,
                        "bg": bg_name,
                        "kind": kind,
                        "pixel_diff_count": ndiff,
                        "max_channel_diff": md,
                        "spike_main": sp_main,
                        "spike_pr": sp_pr,
                    }
                    analysis["cells"].append(rec)
                    analysis["pixel_diffs"].append(
                        {"key": f"{kind}-{css}css-dpr{dpr}-{bg_name}", "count": ndiff, "max": md}
                    )
                # also render 192 as contrast (PR only) — not expected Chrome pick
                im192 = composite_on(render_icon(sources["pr-192"], pixel), bg, pixel)
                k192 = f"pr-192-{css}css-dpr{dpr}-{bg_name}"
                rendered[k192] = im192
                im192.save(RENDERS / f"{k192}.png")
                zoom(im192, 8).save(RENDERS / f"{k192}-8x.png")
                analysis["cells"].append(
                    {
                        "css": css,
                        "dpr": dpr,
                        "pixel": pixel,
                        "bg": bg_name,
                        "kind": "icon-192",
                        "note": "contrast only; not expected Chrome pick",
                        "spike_pr192": spike_report(im192, bg),
                    }
                )

    # spike counts for expected desktop icons (svg+ico, not 192)
    def count_spikes(who, kinds):
        n = 0
        total = 0
        for rec in analysis["cells"]:
            if rec["kind"] not in kinds:
                continue
            key = f"spike_{who}" if who != "pr192" else "spike_pr192"
            if key not in rec:
                continue
            total += 1
            if rec[key]["any_spike"]:
                n += 1
        return n, total

    analysis["spike_counts"] = {
        "main_svg_ico": count_spikes("main", ("svg", "ico")),
        "pr_svg_ico": count_spikes("pr", ("svg", "ico")),
        "pr_192_contrast": count_spikes("pr192", ("icon-192",)),
    }

    # also cairosvg vs rsvg check at 16/32 for documentation
    cairo_vs_rsvg = []
    for size in (16, 32, 32, 64):
        a = cairosvg_raster(PR_PUB / "favicon.svg", size)
        b = rsvg(PR_PUB / "favicon.svg", size)
        # compare RGBA
        nd = pixel_diff_count(a.convert("RGB"), b.convert("RGB"))
        cairo_vs_rsvg.append({"size": size, "rgb_diff_count": nd, "max": max_diff(a.convert("RGB"), b.convert("RGB")), "sizes": [list(a.size), list(b.size)]})
    analysis["cairo_vs_rsvg"] = cairo_vs_rsvg

    # contact sheet: main vs PR SVG+ICO, all bg, 16/32 dpr1 and a dpr2 sheet
    def sheet_for(dpr, kinds=("svg", "ico")):
        cells = []
        for css in (16, 32):
            for kind in kinds:
                for bg_name, _ in backgrounds:
                    im = rendered[f"pr-{kind}-{css}css-dpr{dpr}-{bg_name}"]
                    main_im = rendered[f"main-{kind}-{css}css-dpr{dpr}-{bg_name}"]
                    # side by side in one cell? two entries
                    cells.append((main_im, f"main {kind} {css}@{dpr} {bg_name}"))
                    cells.append((im, f"PR {kind} {css}@{dpr} {bg_name}"))
        return labeled_grid(
            cells,
            f"Desktop tab composites  ·  DPR {dpr}  ·  main (1b73cf2) vs PR #11 (85da191)",
            footer="SVG and ICO only (byte-identical assets). Light #f2f2f7, white, dark #292a2d. 8× nearest zoom.",
        )

    sheet_for(1).save(RENDERS / "contact-desktop-dpr1.png")
    sheet_for(2).save(RENDERS / "contact-desktop-dpr2.png")

    # contrast sheet: SVG vs 192 on each bg at 16 and 32 dpr1/2
    contrast_cells = []
    for dpr in (1, 2):
        for css in (16, 32):
            for bg_name, _ in backgrounds:
                contrast_cells.append((rendered[f"pr-svg-{css}css-dpr{dpr}-{bg_name}"], f"SVG {css}@{dpr} {bg_name}"))
                contrast_cells.append((rendered[f"pr-192-{css}css-dpr{dpr}-{bg_name}"], f"192 {css}@{dpr} {bg_name}"))
    labeled_grid(
        contrast_cells,
        "Contrast: favicon.svg (expected Chrome pick) vs icon-192.png (opaque square) on tab colors",
        footer="icon-192 is a rel=icon with sizes=192x192 listed before the SVG. If a browser picks it, square dark corners return.",
    ).save(RENDERS / "contact-svg-vs-192.png")

    # ---------- Brave iOS simulation ----------
    # 16pt @3x = 48 px, and also 16 px, on dark tab-grid backgrounds
    svg48 = rsvg(PR_PUB / "favicon.svg", 48)
    ico48 = load_ico_frame(PR_PUB / "favicon.ico", 48)
    png48 = load_png(PR_PUB / "icon-192.png", 48)
    svg16 = rsvg(PR_PUB / "favicon.svg", 16)
    ico16 = load_ico_frame(PR_PUB / "favicon.ico", 16)
    png16 = load_png(PR_PUB / "icon-192.png", 16)

    # old behavior: flatten transparent corners onto black, then place on dark grid
    old_svg48_flat = flatten_on_black(svg48, 48)
    old_ico48_flat = flatten_on_black(ico48, 48)
    old_svg16_flat = flatten_on_black(svg16, 16)
    old_ico16_flat = flatten_on_black(ico16, 16)

    brave_bg_list = [("black", IOS_BLACK), ("ios-dark", IOS_TAB), ("brave-tab", BRAVE_TAB)]
    brave = {}
    for bg_name, bg in brave_bg_list:
        for tag, icon in (
            ("pr-192-48", png48),
            ("pr-192-16", png16),
            ("old-svg-flat-48", old_svg48_flat.convert("RGBA")),
            ("old-ico-flat-48", old_ico48_flat.convert("RGBA")),
            ("old-svg-flat-16", old_svg16_flat.convert("RGBA")),
            ("old-ico-flat-16", old_ico16_flat.convert("RGBA")),
            ("svg-trans-48", svg48),  # transparent on the tab color (not flattened to black first)
            ("ico-trans-48", ico48),
        ):
            # For already-flattened (RGB pasted as opaque), composite_on is identity if RGB
            if icon.mode != "RGBA":
                icon_rgba = icon.convert("RGBA")
            else:
                icon_rgba = icon
            # If this is a flatten-on-black image, it's already opaque; placing on grid
            # keeps the black corners. That's the point.
            placed = place_on_grid(icon_rgba, bg, pad=16)
            key = f"brave-{tag}-on-{bg_name}"
            brave[key] = placed
            placed.save(RENDERS / f"{key}.png")
            zoom(placed, 8).save(RENDERS / f"{key}-8x.png")
            # also save the bare icon
            bare = composite_on(icon_rgba, bg, icon_rgba.width)
            bare.save(RENDERS / f"brave-bare-{tag}-on-{bg_name}.png")
            zoom(bare, 8).save(RENDERS / f"brave-bare-{tag}-on-{bg_name}-8x.png")

    # corners of 192@48 and old flatten
    analysis["brave_corners"] = {
        "icon192_48_on_black": corners_of(composite_on(png48.convert("RGBA"), (0, 0, 0), 48)),
        "icon192_48_on_ios": corners_of(composite_on(png48.convert("RGBA"), IOS_TAB, 48)),
        "icon192_48_on_brave": corners_of(composite_on(png48.convert("RGBA"), BRAVE_TAB, 48)),
        "old_svg_flat_48_on_ios": corners_of(place_on_grid(old_svg48_flat.convert("RGBA"), IOS_TAB, pad=0) if False else composite_on(Image.new("RGBA", (48, 48), (0, 0, 0, 255)), IOS_TAB, 48)),
    }
    # compute properly
    analysis["brave_corners"]["old_svg_flat_48"] = corners_of(old_svg48_flat)
    analysis["brave_corners"]["old_ico_flat_48"] = corners_of(old_ico48_flat)
    analysis["brave_corners"]["icon192_48"] = corners_of(png48.convert("RGB"))
    analysis["brave_corners"]["icon192_16"] = corners_of(png16.convert("RGB"))
    analysis["brave_spike_192_on_ios"] = spike_report(composite_on(png48.convert("RGBA"), IOS_TAB, 48), IOS_TAB)
    analysis["brave_spike_192_on_black"] = spike_report(composite_on(png48.convert("RGBA"), (0, 0, 0), 48), (0, 0, 0))
    analysis["brave_spike_old_svg_flat_on_ios"] = spike_report(
        composite_on(old_svg48_flat.convert("RGBA"), IOS_TAB, 48), IOS_TAB
    )

    # Does the PR icon show a dark frame or edge?
    # Compare corner lum vs mid-top / vs background. A "dark frame" like Kyle's
    # is near-black corners (lum ~ 7-10) against a mid-tone tile.
    def frame_note(im, bg):
        c = corners_of(im)
        bg_l = lum(bg)
        mid = lum(c["midtop"])
        notes = {}
        for k, rgb in c.items():
            notes[k] = {
                "rgb": rgb,
                "lum": round(lum(rgb), 2),
                "dL_vs_bg": round(lum(rgb) - bg_l, 2),
                "near_black": lum(rgb) < 15,
            }
        # dark frame if corners are near-black AND substantially darker than midtop
        corners_only = [notes[k] for k in ("tl", "tr", "bl", "br")]
        dark_frame = all(n["near_black"] for n in corners_only) and mid - lum(c["tl"]) > 15
        # square opaque corners (the #9 bug) if corners are the tile gradient, not bg and not black-frame
        return {"corners": notes, "midtop_lum": round(mid, 2), "dark_frame_like_kyle": dark_frame}

    analysis["brave_frame_assessment"] = {
        "pr_192_48_on_ios": frame_note(composite_on(png48.convert("RGBA"), IOS_TAB, 48), IOS_TAB),
        "pr_192_48_on_black": frame_note(composite_on(png48.convert("RGBA"), (0, 0, 0), 48), (0, 0, 0)),
        "old_svg_flat_on_black": frame_note(old_svg48_flat, (0, 0, 0)),
        "old_svg_flat_placed_on_ios": frame_note(
            composite_on(old_svg48_flat.convert("RGBA"), IOS_TAB, 48), IOS_TAB
        ),
    }

    # Kyle screenshot
    kyle_full, kyle_top = crop_kyle_favicon(KYLE_JPG)
    kyle_top.save(RENDERS / "kyle-ios-tabs-top-copy.png")
    kyle_crop, kyle_box = find_voxloom_icon_in_kyle(kyle_full)
    analysis["kyle_crop_box"] = kyle_box
    if kyle_crop is not None:
        kyle_crop.save(RENDERS / "kyle-voxloom-icon-crop.png")
        zoom(kyle_crop, 8).save(RENDERS / "kyle-voxloom-icon-crop-8x.png")
        analysis["kyle_crop_size"] = list(kyle_crop.size)
        analysis["kyle_crop_corners"] = corners_of(kyle_crop)
    else:
        analysis["kyle_crop_size"] = None

    # Also use Web Dev's 48 crop if present
    wd_kyle48 = WEBDEV / "kyle-voxloom-48.png"
    wd_brave48 = WEBDEV / "brave-192-to-48.png"
    if wd_kyle48.exists():
        k48 = Image.open(wd_kyle48).convert("RGB")
        analysis["webdev_kyle48_size"] = list(k48.size)
        analysis["webdev_kyle48_corners"] = corners_of(k48)
        k48.save(RENDERS / "webdev-kyle-voxloom-48-copy.png")
        zoom(k48, 8).save(RENDERS / "webdev-kyle-voxloom-48-copy-8x.png")
    if wd_brave48.exists():
        b48 = Image.open(wd_brave48).convert("RGB")
        mine = composite_on(png48.convert("RGBA"), BRAVE_TAB, 48)
        analysis["vs_webdev_brave48"] = {
            "webdev_size": list(b48.size),
            "mine_size": list(mine.size),
            "pixel_diff_count": pixel_diff_count(b48, mine) if b48.size == mine.size else None,
            "max_channel_diff": max_diff(b48, mine) if b48.size == mine.size else None,
            "webdev_corners": corners_of(b48),
            "mine_corners": corners_of(mine),
        }
        # if sizes differ, try compositing on black / ios too
        for name, bg in (("black", (0, 0, 0)), ("ios", IOS_TAB), ("white", (255, 255, 255))):
            alt = composite_on(png48.convert("RGBA"), bg, 48)
            if b48.size == alt.size:
                analysis["vs_webdev_brave48"][f"vs_{name}"] = {
                    "pixel_diff_count": pixel_diff_count(b48, alt),
                    "max": max_diff(b48, alt),
                }

    # Side-by-side Brave compare sheet
    def tab_card(im, title, bg=(22, 22, 24)):
        z = zoom(im, 8)
        f2 = font(16)
        fb = font_bold(18)
        pad = 16
        W = max(z.width, 200) + pad * 2 + 8
        H = 44 + z.height + 40
        canvas = Image.new("RGB", (W, H), bg)
        draw = ImageDraw.Draw(canvas)
        draw.text((pad, 10), title, fill=(230, 230, 230), font=fb)
        canvas.paste(ImageOps.expand(z, 1, (70, 70, 70)), (pad, 40))
        draw.text((pad, 44 + z.height + 8), f"{im.width}×{im.height}  8× zoom", fill=(150, 150, 155), font=f2)
        return canvas

    cards = []
    if wd_kyle48.exists():
        cards.append(tab_card(Image.open(wd_kyle48).convert("RGB"), "Kyle crop (current, black corners)"))
    if kyle_crop is not None:
        # resize to 48 for visual if needed
        kc = kyle_crop.resize((48, 48), Image.Resampling.LANCZOS) if kyle_crop.size != (48, 48) else kyle_crop
        cards.append(tab_card(kc, f"My crop from Kyle jpg {kyle_box}"))
    cards.append(tab_card(composite_on(png48.convert("RGBA"), BRAVE_TAB, 48), "PR icon-192 → 48 on #1c1c1c"))
    cards.append(tab_card(composite_on(png48.convert("RGBA"), IOS_TAB, 48), "PR icon-192 → 48 on #1c1c1e"))
    cards.append(tab_card(old_svg48_flat, "Old: SVG flattened onto black"))
    cards.append(tab_card(old_ico48_flat, "Old: ICO flattened onto black"))
    cards.append(tab_card(composite_on(png16.convert("RGBA"), IOS_TAB, 16), "PR icon-192 → 16 on #1c1c1e"))
    cards.append(tab_card(old_svg16_flat, "Old: SVG 16 flattened onto black"))

    gap = 16
    W = sum(c.width for c in cards) + gap * (len(cards) + 1)
    H = max(c.height for c in cards) + 80
    sheet = Image.new("RGB", (W, H), (14, 14, 16))
    dr = ImageDraw.Draw(sheet)
    dr.text((20, 14), "Brave iOS pipeline simulation (not a real Brave/iPhone)  ·  16pt@3x = 48 px and 16 px", fill=(235, 235, 235), font=font_bold(22))
    x = gap
    for c in cards:
        sheet.paste(c, (x, 56))
        x += c.width + gap
    sheet.save(RENDERS / "contact-brave-ios-sim.png")

    # smaller 16+48 on dark grid next to kyle top crop
    kyle_top_resized = kyle_top.copy()
    # scale kyle top to a reasonable width
    target_w = 720
    scale = target_w / kyle_top_resized.width
    kyle_show = kyle_top_resized.resize((target_w, int(kyle_top_resized.height * scale)), Image.Resampling.LANCZOS)
    right_cards = Image.new("RGB", (640, kyle_show.height), (14, 14, 16))
    # paste a few zoomed sims
    y = 16
    for im, title in (
        (composite_on(png48.convert("RGBA"), IOS_TAB, 48), "PR 192→48 on #1c1c1e"),
        (old_svg48_flat, "Old SVG flattened on black (the bug)"),
    ):
        z = zoom(im, 6)
        ImageDraw.Draw(right_cards).text((16, y), title, fill=(220, 220, 220), font=font(16))
        right_cards.paste(z, (16, y + 22))
        y += z.height + 40
    combo = Image.new("RGB", (kyle_show.width + 24 + right_cards.width, max(kyle_show.height, right_cards.height) + 50), (14, 14, 16))
    ImageDraw.Draw(combo).text((16, 12), "Kyle iOS dark tab switcher (read-only jpg) vs simulated pipelines", fill=(235, 235, 235), font=font_bold(20))
    combo.paste(kyle_show, (12, 44))
    combo.paste(right_cards, (kyle_show.width + 24, 44))
    combo.save(RENDERS / "contact-kyle-vs-sim.png")

    # ---------- Chrome request capture ----------
    access_log = []
    log_lock = threading.Lock()
    port_main = find_free()
    port_pr = find_free()
    debug_port = find_free()
    s_main = serve(MAIN_PUB, port_main, "main", access_log, log_lock)
    s_pr = serve(PR_PUB, port_pr, "pr", access_log, log_lock)
    pages = ["index.html", "download.html", "privacy.html", "changelog.html"]
    chrome_info = {
        "port_main": port_main,
        "port_pr": port_pr,
        "debug_port": debug_port,
        "chrome_version_cmd": subprocess.check_output([CHROME, "--version"], text=True).strip(),
    }
    proc = None
    try:
        proc, ws = await chrome_session(debug_port, Path("/tmp/qa-site11/chrome-profile"))
        chrome_info["ws"] = "connected"
        main_pages = await inspect_pages(ws, f"http://127.0.0.1:{port_main}", pages, "main", wait_s=4.0)
        pr_pages = await inspect_pages(ws, f"http://127.0.0.1:{port_pr}", pages, "pr", wait_s=4.0)
    finally:
        if proc:
            proc.send_signal(signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
        s_main.shutdown()
        s_pr.shutdown()

    def slim(page_results):
        out = []
        for r in page_results:
            captured_meta = {}
            for k, v in r["captured"].items():
                if isinstance(v, Image.Image):
                    captured_meta[k] = {"size": list(v.size), "mode": v.mode}
                else:
                    captured_meta[k] = v
            out.append(
                {
                    "label": r["label"],
                    "page": r["page"],
                    "requests": r["requests"],
                    "icon_hits": r["icon_hits"],
                    "links": r["links"],
                    "captured": captured_meta,
                }
            )
        return out

    # save favicon2 screenshots for index only
    def save_fav2(page_results, tag):
        for r in page_results:
            page = r["page"].rsplit("/", 1)[-1].replace(".html", "")
            for key, im in r["captured"].items():
                if not isinstance(im, Image.Image):
                    continue
                size = int(key.split("@")[0])
                scale = 2 if "2x" in key else 1
                pixel = size * scale
                im.save(RENDERS / f"favicon2-full-{tag}-{page}-{key}.png")
                crop_icon(im, pixel).save(RENDERS / f"favicon2-crop-{tag}-{page}-{key}.png")

    save_fav2(main_pages, "main")
    save_fav2(pr_pages, "pr")

    # access log summary
    def summarize_log(label):
        recs = [a for a in access_log if a["label"] == label]
        paths = [a["path"] for a in recs]
        icons = [p for p in paths if any(n in p for n in ICON_NAMES) or p.rstrip("/").endswith("favicon.ico")]
        return {"all_paths": paths, "icon_or_manifest_paths": icons, "count": len(recs)}

    chrome_out = {
        "chrome": chrome_info,
        "main": slim(main_pages),
        "pr": slim(pr_pages),
        "server_log_main": summarize_log("main"),
        "server_log_pr": summarize_log("pr"),
        "server_log_raw": access_log,
        "note": "Headless Chrome has no visible tab strip. chrome://favicon2 often renders a generic placeholder in this environment. Network.requestWillBeSent plus the logging HTTP server are the evidence of which icon URLs were fetched.",
    }
    (LOGS / "chrome-requests.json").write_text(json.dumps(chrome_out, indent=2, default=str) + "\n")

    # union of icon hits
    def union_hits(pages_slim):
        u = []
        for p in pages_slim:
            for h in p["icon_hits"]:
                if h not in u:
                    u.append(h)
        return u

    analysis["chrome_icon_hits_main"] = union_hits(chrome_out["main"])
    analysis["chrome_icon_hits_pr"] = union_hits(chrome_out["pr"])
    analysis["server_icon_paths_main"] = chrome_out["server_log_main"]["icon_or_manifest_paths"]
    analysis["server_icon_paths_pr"] = chrome_out["server_log_pr"]["icon_or_manifest_paths"]

    (LOGS / "render-analysis.json").write_text(json.dumps(analysis, indent=2) + "\n")

    # print summary
    print("IDENTICAL main vs PR svg/ico composites:", analysis["identical_main_pr_svg_ico"])
    print("pixel diffs:", json.dumps(analysis["pixel_diffs"]))
    print("spike counts:", analysis["spike_counts"])
    print("chrome hits main:", analysis["chrome_icon_hits_main"])
    print("chrome hits pr:", analysis["chrome_icon_hits_pr"])
    print("server main icons:", analysis["server_icon_paths_main"])
    print("server pr icons:", analysis["server_icon_paths_pr"])
    print("brave frame:", json.dumps(analysis["brave_frame_assessment"], indent=2))
    print("vs webdev:", json.dumps(analysis.get("vs_webdev_brave48"), indent=2))
    print("kyle crop box:", analysis.get("kyle_crop_box"))
    print("DONE")


if __name__ == "__main__":
    asyncio.run(main())
