import sys, asyncio, json
from playwright.async_api import async_playwright
async def main(jobs):
    async with async_playwright() as p:
        b = await p.chromium.connect_over_cdp("http://localhost:29229")
        ctx = await b.new_context(viewport={"width":1280,"height":1300}, device_scale_factor=1.5, color_scheme="dark")
        for url,out,wait in jobs:
            page = await ctx.new_page()
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(wait)
                await page.screenshot(path=out)
                print(out, await page.title())
            except Exception as e: print(out, "ERR", str(e)[:200])
            await page.close()
        await ctx.close()
asyncio.run(main(json.loads(sys.argv[1])))
