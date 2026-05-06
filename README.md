# Local TOTP Autofill

一个本地自用的 Chrome Manifest V3 插件：导入 Aegis / Google Authenticator 的 TOTP 条目，在当前网站一键生成并填充 2FA 验证码。

## 安全边界

- 不联网，不上传，不同步。
- `manifest.json` 不声明 `host_permissions`。
- 只在点击插件时通过 `activeTab` + `scripting` 对当前页面执行一次填充脚本。
- 第一版按需求不设置主密码，导入后 TOTP secret 会保存在 `chrome.storage.local`，请只在自己的电脑使用。Aegis 加密备份密码只在导入时用于本地解密，不会保存。

## 支持导入

- Aegis：未加密 plain JSON 备份，以及带密码的加密 JSON 备份。
- Google Authenticator：`otpauth-migration://offline?data=...` 迁移二维码内容。
- 标准单条：`otpauth://totp/...` URI。
- Google Authenticator 二维码图片：设置页会尝试使用 Chrome 内置 `BarcodeDetector` 识别；如果浏览器不支持，请先用其他工具识别出 `otpauth-migration://...` 后粘贴。

## 本地加载

1. 打开 Chrome：`chrome://extensions/`
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录：`/Users/heqifeng/totp-autofill-extension`
5. 点击插件图标，进入“导入/管理”导入账号。
6. 如果导入 Aegis 加密 JSON，先在“ Aegis 加密备份密码”输入框填入 Aegis 备份密码。

## 使用

1. 打开需要输入 2FA 的网站。
2. 点击插件图标。
3. 插件会按当前域名匹配条目。
4. 点击“填充当前网站”或“复制”。

## 开发验证

```bash
npm test
npm run check
```
