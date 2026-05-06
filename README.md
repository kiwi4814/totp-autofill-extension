# Local TOTP Autofill

Local TOTP Autofill 是一个本地优先的 Chrome Manifest V3 扩展：导入 Aegis / Google Authenticator / `otpauth://` TOTP 条目，在当前网站生成验证码，并按需复制或填充 2FA 输入框。

项目仓库：<https://github.com/kiwi4814/totp-autofill-extension>

## 当前项目状态

- 当前版本：`0.1.0`
- 扩展类型：Chrome Manifest V3
- 技术栈：Vanilla JavaScript ES Modules、WebCrypto、Node.js built-in test runner
- 依赖策略：运行时代码无第三方依赖
- 开源协议：MIT License
- 当前测试：核心逻辑使用 Node.js 测试覆盖，执行 `npm test`
- 当前语法检查：执行 `npm run check`

## 安全边界

本项目的设计目标是“本地自用、权限克制、无网络同步”。

- 不联网，不上传，不同步。
- `manifest.json` 不声明 `host_permissions`。
- Chrome 权限仅包含：
  - `activeTab`
  - `scripting`
  - `storage`
- 只在用户点击扩展并主动填充时，通过 `activeTab` + `scripting` 对当前页面注入一次填充脚本。
- 当前版本不设置主密码；导入后的 TOTP secret 会保存在 `chrome.storage.local`。
- Aegis 加密备份密码只在导入时用于本地解密，不会保存。

> 使用建议：当前版本适合个人自用电脑。若需要在共享设备或高安全场景使用，请优先实现 `todos.md` 中的“可选主密码 / 加密存储”。

## 当前支持的导入方式

- Aegis plain JSON 备份。
- Aegis 密码加密 JSON 备份。
- Google Authenticator `otpauth-migration://offline?data=...` 迁移内容。
- 标准单条 `otpauth://totp/...` URI。
- Google Authenticator 二维码图片：设置页会尝试使用 Chrome 内置 `BarcodeDetector` 识别；如果浏览器不支持，请先用其他工具识别出 `otpauth-migration://...` 后粘贴。

## 当前已实现功能

### Popup 使用流程

- 读取当前活动标签页域名。
- 按当前域名匹配已保存的 TOTP 条目。
- 显示验证码和剩余倒计时。
- 支持复制验证码。
- 支持一键填充当前页面。
- 当前网站无自动匹配时，会列出所有条目；选择正确条目后点击“绑定当前网站并填充”，后续会自动匹配该域名。

### 设置页管理

- 导入 Aegis JSON 文件。
- 粘贴 Aegis JSON、`otpauth://...` 或 `otpauth-migration://...` 文本导入。
- 识别 Google Authenticator 二维码图片（依赖 Chrome `BarcodeDetector`）。
- 搜索已保存条目。
- 编辑条目的：
  - issuer
  - account
  - 匹配域名 domains
- 删除单条条目。
- 清空全部条目。

### 自动填充能力

- 支持常规单个验证码输入框。
- 支持多格 / 单字符 OTP 输入框逐位填入。
- 支持带强 OTP 特征的 `password` 验证码输入框。
- 避免把验证码填入普通密码框。
- 填充时会触发 `input` 和 `change` 事件，兼容常见前端框架。

### 域名匹配能力

- 自动标准化域名。
- 去除常见前缀，例如 `www`、`login`、`auth`、`accounts` 等。
- 支持用户手动维护多个域名 alias。
- 只保存域名 alias，不保存当前页面路径。

## 项目结构

```text
.
├── manifest.json                 # Chrome MV3 扩展声明
├── package.json                  # Node 测试和语法检查脚本
├── LICENSE                       # MIT License
├── README.md                     # 当前项目说明
├── todos.md                      # 后续优化清单
├── src
│   ├── background.js             # 预留的扩展后台入口
│   ├── storage.js                # chrome.storage.local 读写和条目更新
│   ├── popup.html                # Popup 页面
│   ├── popup.js                  # Popup 交互、匹配、复制、填充、域名绑定
│   ├── options.html              # 设置页
│   ├── options.js                # 导入、搜索、编辑、删除、清空
│   ├── styles.css                # Popup / 设置页共享样式
│   ├── content
│   │   └── autofill.js           # 注入页面的填充脚本
│   └── core
│       ├── autofill-planner.js   # 可测试的填充策略选择逻辑
│       ├── base32.js             # Base32 encode/decode
│       ├── bytes.js              # bytes/hex/base64 工具
│       ├── importers.js          # Aegis / Google Authenticator / otpauth 导入
│       ├── matcher.js            # 域名匹配和排序
│       ├── scrypt.js             # Aegis 加密备份解密所需 scrypt
│       └── totp.js               # HOTP/TOTP 生成
└── tests
    └── core.test.mjs             # 核心逻辑测试
```

## 本地加载

1. 打开 Chrome：`chrome://extensions/`
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录。
5. 点击插件图标，进入“导入/管理”导入账号。
6. 如果导入 Aegis 加密 JSON，先在“Aegis 加密备份密码”输入框填入 Aegis 备份密码。

## 使用方式

1. 打开需要输入 2FA 的网站。
2. 点击插件图标。
3. 如果插件自动匹配到条目，点击“填充当前网站”或“复制”。
4. 如果当前网站没有自动匹配，选择正确条目，点击“绑定当前网站并填充”。
5. 后续访问该域名时，插件会优先自动匹配已绑定条目。

## 管理条目

- 设置页可以编辑条目的 issuer、account 和匹配域名。
- 匹配域名支持多个，用英文逗号、中文逗号或换行分隔。
- 删除条目前请确认该条目不再需要；当前版本没有回收站或导出恢复功能。

## 开发验证

```bash
npm test
npm run check
```

当前测试覆盖：

- Base32 编解码。
- RFC 6238 TOTP 向量。
- `otpauth://` 解析。
- Aegis plain JSON 导入。
- Aegis 加密 JSON 解密导入。
- Google Authenticator migration protobuf 导入。
- 域名匹配排序。
- 域名 alias 标准化与去重。
- 条目信息更新和当前域名绑定。
- 自动填充策略选择：多格 OTP 与强 OTP 特征的 password 输入框。

## 当前限制

- 还没有主密码 / 加密存储。
- 还没有导入预览、导入冲突处理或批量确认。
- 还没有真实浏览器端自动化测试。
- 设置页和 Popup UI 仍然比较基础。
- 填充逻辑尚未支持 Shadow DOM、iframe、用户手动选择输入框等复杂页面。
- 当前没有打包发布流程，也没有 Chrome Web Store 发布配置。

## 后续计划

所有推荐优化项统一维护在 [`todos.md`](./todos.md)。
