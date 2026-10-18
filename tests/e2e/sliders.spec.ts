import {test,expect} from '@playwright/test';
test('negative slider range remains bounded through pointer, drag, keyboard and remount',async({page})=>{
 await page.goto('./');await page.getByRole('button',{name:/智能抠图/}).click();
 const slider=page.locator('mdui-slider[aria-label="边缘收缩或扩张"]');
 const verify=async()=>{
  const state=await slider.evaluate(e=>{const slider=e as HTMLElement&{value:number;min:number;max:number;step:number};return {value:slider.value,min:slider.min,max:slider.max,step:slider.step,left:parseFloat(slider.shadowRoot!.querySelector<HTMLElement>('[part="handle"]')!.style.left)};});
  expect(state.value).toBeGreaterThanOrEqual(-20);expect(state.value).toBeLessThanOrEqual(20);expect([state.min,state.max,state.step]).toEqual([-20,20,1]);expect(state.left).toBeGreaterThanOrEqual(0);expect(state.left).toBeLessThanOrEqual(100);
 };
 await slider.click();await verify();const input=slider.locator('input');await input.focus();
 await input.press('Home');await expect(input).toHaveValue('-20');await verify();await input.press('End');await expect(input).toHaveValue('20');await verify();
 const box=(await slider.boundingBox())!;await page.mouse.move(box.x+box.width-12,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+12,box.y+box.height/2,{steps:12});await page.mouse.up();await verify();
 for(let i=0;i<3;i++){await slider.click({position:{x:box.width*(i+1)/4,y:box.height/2}});await verify();}
 await page.getByRole('button',{name:/图像超分/}).click();await page.getByRole('button',{name:/智能抠图/}).click();await slider.click();await verify();
});
