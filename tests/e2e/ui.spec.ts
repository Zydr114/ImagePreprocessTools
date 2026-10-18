import {test,expect} from '@playwright/test';
import type {Page,Download} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function select(page:Page,label:string,value:string){const el=page.locator(`mdui-select[label="${label}"]`);await el.click();await el.locator(`mdui-menu-item[value="${value}"]`).click();}
async function importFixture(page:Page){await page.locator('input[type=file]').setInputFiles('tests/fixtures/odd-alpha.png');await expect(page.locator('.file-strip')).toContainText('67 × 49');}
async function save(page:Page,format='image/png'){
 await page.getByRole('button',{name:'导出图像',exact:true}).click();await expect(page.locator('mdui-dialog[headline="导出图像"]')).toBeVisible();
 if(format!=='image/png')await select(page,'文件格式',format);
 const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'保存到设备',exact:true}).click();return waiting;
}
async function inspect(page:Page,download:Download){const bytes=await readFile((await download.path())!);return page.evaluate(async({bytes,type})=>{const image=await createImageBitmap(new Blob([Uint8Array.from(bytes)],{type})),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;let minAlpha=255,maxAlpha=0;for(let i=3;i<data.length;i+=4){minAlpha=Math.min(minAlpha,data[i]!);maxAlpha=Math.max(maxAlpha,data[i]!);}return {width:image.width,height:image.height,minAlpha,maxAlpha,center:[...data.slice((Math.floor(image.height/2)*image.width+Math.floor(image.width/2))*4,(Math.floor(image.height/2)*image.width+Math.floor(image.width/2))*4+4)]};},{bytes:[...bytes],type:download.suggestedFilename().endsWith('.jpg')?'image/jpeg':download.suggestedFilename().endsWith('.webp')?'image/webp':'image/png'});}
test.beforeEach(async({page})=>{const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));(page as Page&{errors:string[]}).errors=errors;await page.goto('/');await page.waitForFunction(()=>!!customElements.get('mdui-select'));});
test.afterEach(async({page})=>{expect((page as Page&{errors:string[]}).errors).toEqual([]);});
test('page, theme, import, curves, comparison and three actual export formats',async({page})=>{
 await expect(page).toHaveTitle(/像素工坊/);await page.screenshot({path:'artifacts/ui/accepted-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'切换深色主题',exact:true}).click();await expect(page.locator('html')).toHaveClass(/mdui-theme-dark/);await page.reload();await expect(page.locator('html')).toHaveClass(/mdui-theme-dark/);await page.getByRole('button',{name:'切换浅色主题',exact:true}).click();
 await importFixture(page);await page.getByRole('button',{name:/曲线调色/}).click();await page.getByRole('button',{name:'暖意',exact:true}).click();
 const split=page.getByRole('slider',{name:'原图与处理后对比分割线'});await split.focus();await split.press('ArrowRight');await expect(split).toHaveAttribute('aria-valuenow','52');
 await page.getByRole('button',{name:'放大',exact:true}).click();await expect(page.locator('.zoom-value')).toHaveText('125%');
 await page.screenshot({path:'artifacts/ui/accepted-curves.png',fullPage:true});
 for(const format of ['image/png','image/jpeg','image/webp']){const download=await save(page,format),out=await inspect(page,download);expect([out.width,out.height]).toEqual([67,49]);if(format==='image/jpeg')expect(out.minAlpha).toBe(255);else expect(out.minAlpha).toBe(0);expect(out.maxAlpha).toBe(255);}
 await page.getByRole('button',{name:'应用调整',exact:true}).click();await expect(page.locator('.step-badge')).toContainText('1');await page.getByRole('button',{name:'恢复原图',exact:true}).click();await expect(page.locator('.step-badge')).toHaveCount(0);
});
test('explicit WebGL super resolution, decimal output, reuse and original recovery',async({page})=>{
 await importFixture(page);await select(page,'超分模型','realesr-anime');await select(page,'计算后端','webgl');await page.getByTestId('scale-input').fill('1.7');await page.getByTestId('scale-input').press('Tab');await expect(page.locator('.output-dimensions')).toContainText('114 × 83');
 await page.getByRole('button',{name:'开始超分',exact:true}).click();await expect(page.locator('.result-detail')).toContainText('WebGL',{timeout:60000});const output=await inspect(page,await save(page));expect([output.width,output.height]).toEqual([114,83]);expect(output.minAlpha).toBeLessThan(5);
 await page.getByRole('button',{name:'作为下一步输入',exact:true}).click();await expect(page.locator('.file-strip')).toContainText('114 × 83');await page.getByRole('button',{name:/曲线调色/}).click();await expect(page.locator('.file-strip')).toContainText('114 × 83');await page.getByRole('button',{name:'恢复原图',exact:true}).click();await expect(page.locator('.file-strip')).toContainText('67 × 49');
});
test('foreground extraction, mask options, inversion and transparent PNG export',async({page})=>{
 await importFixture(page);await page.getByRole('button',{name:/智能抠图/}).click();await select(page,'计算后端','wasm');await page.getByRole('button',{name:'开始抠图',exact:true}).click();await expect(page.locator('.result-detail')).toContainText('WASM',{timeout:60000});
 const maskSwitch=page.locator('.option-switch').filter({hasText:'查看黑白遮罩'}).locator('mdui-switch');await maskSwitch.click();await expect(page.locator('.preview-title')).toContainText('遮罩');await page.screenshot({path:'artifacts/ui/accepted-mask.png',fullPage:true});await maskSwitch.click();
 await page.locator('.option-switch').filter({hasText:'反选前景'}).locator('mdui-switch').click();const output=await inspect(page,await save(page));expect([output.width,output.height]).toEqual([67,49]);expect(output.minAlpha).toBe(0);expect(output.maxAlpha).toBeGreaterThan(0);
});
test('cancel leaves input unchanged, malformed images produce an error',async({page})=>{
 await importFixture(page);await page.getByRole('button',{name:'开始超分',exact:true}).click();await page.getByRole('button',{name:'取消处理',exact:true}).click();await expect(page.getByRole('button',{name:'开始超分',exact:true})).toBeEnabled();await expect(page.locator('.file-strip')).toContainText('67 × 49');await expect(page.locator('.result-detail')).toContainText('参数就绪');
 await page.locator('input[type=file]').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')});await expect(page.getByRole('alert')).toContainText('无法解码');await expect(page.locator('.file-strip')).toContainText('67 × 49');
});
test('mobile layout, parameter drawer, dark mode and no horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await expect(page.locator('.mobile-params')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/ui/accepted-mobile.png',fullPage:true});await page.locator('.demo-button').click();await page.getByRole('button',{name:/曲线调色/}).click();await page.locator('.mobile-params').click();await expect(page.locator('.parameters')).toHaveClass(/mobile-open/);await expect(page.locator('.curve-graph')).toBeVisible();await expect.poll(async()=>Math.round(await page.locator('.parameters').evaluate(e=>e.getBoundingClientRect().left))).toBe(40);await page.screenshot({path:'artifacts/ui/accepted-mobile-params.png',fullPage:true});await page.getByRole('button',{name:'关闭参数面板',exact:true}).click();await expect(page.locator('.params-backdrop')).toHaveCount(0);await page.getByRole('button',{name:'切换深色主题',exact:true}).click();await page.screenshot({path:'artifacts/ui/accepted-mobile-dark.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
