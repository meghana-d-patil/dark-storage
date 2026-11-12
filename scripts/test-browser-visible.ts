import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  const title = await page.title();
  console.log('Page title:', title);
  await page.screenshot({ path: 'qa-audit/EVIDENCE/00-initial-landing.png' });
  console.log('Screenshot saved to qa-audit/EVIDENCE/00-initial-landing.png');
  await browser.close();
}

main().catch(console.error);
