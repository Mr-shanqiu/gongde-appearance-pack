# 牛马电子功德形象制作 Skill

用 AI 和本地工具制作可以导入牛马电子功德 Windows / Mac 0.9.5 的 DIY 桌面形象。含规范、挥手小铃模板、校验器、静止与动作预览、`.nmgpack` 打包工具。

## 安装到 Agent

```sh
npx skills add Mr-shanqiu/gongde-appearance-pack --skill gongde-appearance-pack
```

按安装器提示选择你的 Agent 与安装范围。也可以让支持技能安装的 Agent 从本仓库 `skills/gongde-appearance-pack` 目录安装；其他环境从 [Releases](https://github.com/Mr-shanqiu/gongde-appearance-pack/releases) 下载 ZIP 并手动放入技能目录。支持程度取决于所用 Agent；Node.js 18+ 是制作工具的运行要求。

安装一次后可重复使用。对 Agent 说：“用 gongde-appearance-pack 帮我制作一个挥手的小角色，生成静止和动作预览，检查后打包成可导入的形象包。”图片生成依赖你所用 Agent 的绘图能力，也可使用自己合法拥有的透明 PNG 素材。

## 不依赖 Agent 使用

从 `skills/gongde-appearance-pack` 目录运行（输出放到新的作品目录）：

```sh
node scripts/new-pack.mjs ./my-figure --author "你的署名"
node scripts/check-pack.mjs ./my-figure
node scripts/render-preview.mjs ./my-figure ./rest.png
node scripts/render-preview.mjs ./my-figure ./action.png 0.42
node scripts/build-pack.mjs ./my-figure ./my-figure.nmgpack
```

生成后双击 `.nmgpack` 导入客户端，再在“更换形象”中选择。最多 6 图层，支持位置、旋转、缩放和透明度关键帧；推荐压缩包不超过 8 MiB，展开不超过 12 MiB。骨骼、序列帧及多个命名动作不在当前格式范围内。

## 官网与投稿

[官网下载客户端](https://gongde.zqscreen.cn/download.html) · [Skill 与人工投稿说明](https://gongde.zqscreen.cn/support.html#creation) · [主项目](https://github.com/Mr-shanqiu/niuma-ELEC-gongde)

自己制作和导入无需投稿。愿意分享时，在官网同一区域阅读协议并一键生成确认，再通过抖音群联系管理员。投稿及必要适配版免费，作者保留版权；下载或安装 Skill 不代表同意投稿。发布包不含官方付费形象、客户端、密钥或账号材料。

## 版本与许可证

当前版本：1.3.1。制作工具及模板与已验证的 1.3.0 相同，更新公开安装说明、客户端发布绑定和官网投稿确认方式。版本标签固定；升级由用户主动执行，没有后台自动更新。

代码按 [GPL-3.0](LICENSE) 分发。程序生成的模板可按模板规则使用；作者自己的原创素材及生成作品不会仅因使用本工具而自动改为 GPL 授权。第三方或 AI 素材的权利由各自许可决定，投稿授权另按官网协议确认。
