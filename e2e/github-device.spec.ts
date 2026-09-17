import {test,expect,type Page} from '@playwright/test';
const KEY='renewal-github-device-v1';
async function settings(page:Page) {
  if(await page.getByRole('button',{name:'打开菜单'}).isVisible()) await page.getByRole('button',{name:'打开菜单'}).click();
  await page.getByRole('button',{name:'设置与数据',exact:true}).click();
}
async function fill(page:Page,token='device-test-token') {
  await page.getByLabel('GitHub 用户名').fill('TestOwner');
  await page.getByLabel('私有数据仓库').fill('renewal-data');
  await page.getByLabel('访问令牌').fill(token);
}
async function mock(page:Page,mode:()=>string=()=> 'ok') {
  await page.route('https://api.github.com/repos/TestOwner/renewal-data**',async route=>{
    if(mode()==='network') return route.abort();
    if(mode()==='unauthorized') return route.fulfill({status:401,json:{}});
    expect(route.request().method()).toBe('GET');
    return route.fulfill(route.request().url().includes('/contents/')?{status:404,json:{}}:{json:{private:true}});
  });
}
test('remember is opt-in, persists only after success and reconnects across page opens',async({page})=>{
  await mock(page);await page.goto('/');await settings(page);
  await expect(page.getByRole('checkbox',{name:'在此设备记住令牌'})).not.toBeChecked();
  await fill(page);await page.getByRole('button',{name:'连接私有仓库'}).click();
  await expect(page.getByText('已连接私有仓库：TestOwner/renewal-data')).toBeVisible();
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
  await page.reload();await settings(page);await expect(page.getByRole('button',{name:'连接私有仓库'})).toBeVisible();
  await fill(page);await page.getByRole('checkbox',{name:'在此设备记住令牌'}).check();
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
  await page.getByRole('button',{name:'连接私有仓库'}).click();
  await expect(page.getByText('此浏览器已记住令牌',{exact:true})).toBeVisible();
  await page.reload();await settings(page);await expect(page.getByText('已连接私有仓库：TestOwner/renewal-data')).toBeVisible();
  await expect(page.getByLabel('访问令牌')).toHaveAttribute('type','password');
  await expect(page.getByLabel('访问令牌')).toHaveValue('');
  await page.getByRole('checkbox',{name:'在此设备记住令牌'}).uncheck();
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
  await expect(page.getByText('已连接私有仓库：TestOwner/renewal-data')).toBeVisible();
  await page.getByRole('checkbox',{name:'在此设备记住令牌'}).check();
  await page.getByRole('button',{name:'清除已保存令牌'}).click();
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
  await expect(page.getByText('已连接私有仓库：TestOwner/renewal-data')).toBeVisible();
  await page.reload();await settings(page);await expect(page.getByRole('checkbox',{name:'在此设备记住令牌'})).not.toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
test('failed auto-connect preserves data and saved token; replacement token is saved only on success',async({page})=>{
  let mode='ok';await mock(page,()=>mode);await page.goto('/');await settings(page);await fill(page);
  await page.getByRole('checkbox',{name:'在此设备记住令牌'}).check();await page.getByRole('button',{name:'连接私有仓库'}).click();
  await expect(page.getByText('此浏览器已记住令牌',{exact:true})).toBeVisible();
  const before=await page.evaluate(()=>localStorage.getItem('renewal-demo-v1'));
  mode='network';await page.reload();await expect(page.getByText(/自动连接失败：/)).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('renewal-demo-v1'))).toBe(before);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).token,KEY)).toBe('device-test-token');
  await settings(page);mode='unauthorized';await fill(page,'rejected-test-token');await page.getByRole('button',{name:'连接私有仓库'}).click();
  await expect(page.locator('.github-form').getByRole('alert')).toContainText('令牌失效');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).token,KEY)).toBe('device-test-token');
  mode='ok';await fill(page,'replacement-test-token');await page.getByRole('button',{name:'连接私有仓库'}).click();
  await expect(page.getByText('已连接私有仓库：TestOwner/renewal-data')).toBeVisible();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).token,KEY)).toBe('replacement-test-token');
  await page.reload();await settings(page);await expect(page.getByText('已连接私有仓库：TestOwner/renewal-data')).toBeVisible();
  await page.getByRole('button',{name:'断开同步',exact:true}).click();expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
});
