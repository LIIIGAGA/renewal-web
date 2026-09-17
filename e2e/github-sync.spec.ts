import { test, expect, type Page } from '@playwright/test';
test('desktop/mobile GitHub sync preserves concurrent edits and keeps tokens out of storage',async({page,browser})=>{
  let records:unknown[]=[];let version=0;let writes=0;let exists=false;
  async function routes(p:Page) {
    await p.route('https://api.github.com/repos/TestOwner/renewal-data**',async route=>{
      const request=route.request();
      if(!request.url().includes('/contents/'))return route.fulfill({json:{private:true}});
      if(request.method()==='PUT') {
        const data=request.postDataJSON();
        if((exists&&data.sha!==`version-${version}`)||(!exists&&data.sha))return route.fulfill({status:409,json:{}});
        records=JSON.parse(Buffer.from(data.content,'base64').toString('utf8')).subscriptions;exists=true;version++;writes++;
        return route.fulfill({json:{content:{sha:`version-${version}`}}});
      }
      if(!exists)return route.fulfill({status:404,json:{}});
      return route.fulfill({json:{type:'file',size:1000,encoding:'base64',sha:`version-${version}`,content:Buffer.from(JSON.stringify({format:'renewal-ledger',version:1,subscriptions:records})).toString('base64')}});
    });
  }
  async function connect(p:Page) {
    await p.goto('/');
    if(await p.getByRole('button',{name:'打开菜单'}).isVisible())await p.getByRole('button',{name:'打开菜单'}).click();
    await p.getByRole('button',{name:'设置与数据',exact:true}).click();
    await p.getByLabel('GitHub 用户名').fill('TestOwner');await p.getByLabel('私有数据仓库').fill('renewal-data');await p.getByLabel('访问令牌').fill('fake-token');
    await p.getByRole('button',{name:'连接私有仓库'}).click();
    await expect(p.getByText('已连接私有仓库：TestOwner/renewal-data')).toBeVisible();
    if(await p.getByRole('button',{name:'打开菜单'}).isVisible())await p.getByRole('button',{name:'打开菜单'}).click();
    await p.getByRole('button',{name:'订阅总览',exact:true}).click();
  }
  const mobile=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width:390,height:844},isMobile:true,hasTouch:true});const phone=await mobile.newPage();
  try {
    await routes(page);await routes(phone);await connect(page);await connect(phone);expect(writes).toBe(0);
    await page.getByRole('button',{name:'添加订阅',exact:true}).first().click();await page.getByLabel('服务名称',{exact:true}).fill('Synced Service');await page.getByLabel('分类',{exact:true}).selectOption('AI');await page.getByLabel('每期金额').fill('10');await page.getByRole('button',{name:'保存订阅'}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);await phone.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await phone.getByRole('button',{name:'Synced Service 未填写方案'}).click();await phone.getByRole('button',{name:'编辑订阅',exact:true}).click();await expect(phone.getByLabel('分类',{exact:true})).toHaveValue('AI');
    await page.getByRole('button',{name:'Synced Service 未填写方案'}).click();await page.getByRole('button',{name:'编辑订阅',exact:true}).click();await page.getByLabel('每期金额').fill('15');await page.getByRole('button',{name:'保存订阅'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await phone.getByLabel('每期金额').fill('20');await phone.getByRole('button',{name:'保存订阅'}).click();await expect(phone.getByRole('dialog').getByRole('alert')).toContainText('另一台设备');expect((records[0] as {price:number}).price).toBe(15);
    await phone.getByRole('button',{name:'关闭',exact:true}).click();await expect(phone.locator('.subscription-table').getByText('¥15.00',{exact:true})).toBeVisible();
    expect(await phone.evaluate(()=>JSON.stringify(Object.entries(localStorage)))).not.toContain('fake-token');
    expect(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  } finally {await mobile.close();}
});
