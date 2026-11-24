import sys, asyncio, json, os
from playwright.async_api import async_playwright
FPS=30; tl=json.load(open('timeline.json')); N=int(tl['total']*FPS)
async def worker(ctx, frames, out):
    page=await ctx.new_page()
    page.on("pageerror", lambda e: print("PAGEERR", e))
    await page.goto("file://"+os.path.abspath("video.html")); await page.wait_for_timeout(800)
    for i in frames:
        await page.evaluate("t=>setT(t)", i/FPS)
        await page.screenshot(path=f"{out}/f{i:05d}.jpg", type="jpeg", quality=93)
    await page.close()
async def main():
    out=sys.argv[1]; os.makedirs(out,exist_ok=True)
    frames=[int(float(x)*FPS) for x in sys.argv[2].split(',')] if len(sys.argv)>2 else list(range(N))
    W=1 if len(sys.argv)>2 else 6
    async with async_playwright() as p:
        b=await p.chromium.connect_over_cdp("http://localhost:29229")
        ctx=await b.new_context(viewport={"width":1920,"height":1080})
        await asyncio.gather(*[worker(ctx, frames[k::W], out) for k in range(W)])
        await ctx.close()
    print("frames", len(frames))
asyncio.run(main())
