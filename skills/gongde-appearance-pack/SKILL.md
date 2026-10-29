---
name: gongde-appearance-pack
description: Create, preview, check and package a data-only 牛马电子功德 appearance for direct local import into the Mac and Windows 0.9.5 releases. Use for DIY layered artwork, keyframes and .nmgpack authoring; not client signing, publishing or enabling submissions.
metadata:
  version: "1.3.1"
---

# 牛马电子功德形象制作

本 Skill 自带规范、工具和可运行模板。默认产物是用户可自行导入的 DIY 数据包，不要求平台账号、联网或平台签名。环境需要 Node.js 18 或更新版本；脚本仅使用 Node 内置模块，无需 npm install。

## 先确认能力与形制

- 读取 [格式与双端共同范围](references/pack-format.md) 和 [视觉形制](references/visual-standard.md)。版本绑定见 [client-baseline.json](references/client-baseline.json)：以绑定的双端 0.9.5 发布版及其制作源码为底座，不把相同“0.9.5”版本号当作相同实现。
- 设计动作时读取 [当前动作能力与后续适配](references/animation-guide.md)。当前只生成已支持的schema1/3；骨骼、图片姿态切换、多命名动作和序列帧是未来能力，不能擅自加字段。
- 历史经验不等于格式门槛。先选直立/横向/悬浮，主体与完整动作留在规定范围；不要按部件名称限制运动，不把固定布局偏移当成动画位移。

## 一次完成制作

以下命令从 Skill 文件夹执行；输出放到新的作品目录。路径含空格时引用整个路径。

```sh
node scripts/new-pack.mjs /path/to/my-pack --id diy.author.my-figure --author "作者名字"
node scripts/check-pack.mjs /path/to/my-pack
node scripts/render-preview.mjs /path/to/my-pack /path/to/rest-new.png
node scripts/render-preview.mjs /path/to/my-pack /path/to/peak-new.png 0.42
node scripts/build-pack.mjs /path/to/my-pack /path/to/my-figure.nmgpack
```

1. 使用 new-pack 获得可导入的挥手小铃模板。若不指定ID，工具生成唯一DIY ID；修改同一作品保留ID和publisher、更新version。模板是程序生成的制作示例，不冒充官方形象，也不是风格上限。
2. 替换透明PNG并编辑manifest。主体、部件、锚点和静止姿态由同一清单确定；露出的底图完整，不通过官网或客户端专属坐标补救构图。可用AI或绘图工具创作，Skill不依赖某个图像服务。
3. 静止预览输出480×340，不含+1、总功德、时间或加班状态。render-preview只写新文件；确认后由作者将静止图替换为源目录preview.png，再检查和封装。峰值图是验收材料，放在源目录之外，不能误作preview。新素材仅使用当前客户端支持的字段。
4. 结构错误先修复；视觉警告按规范复核。工具输出静止/动作采样边界与四边留白，不自动识别真实脚底或角色主体。完整动作还要看关节、遮挡、缩小显示及深浅背景；采样通过不证明连续过程无裁切。
5. build-pack生成普通ZIP的.nmgpack，拒绝覆盖现有文件，不签名、不读取私钥，也不自动导入、上传或发布。源目录不能含脚本、子目录、符号链接或未引用图片。
6. 交付.nmgpack、静止预览、完整动作预览或实际播放记录，并准确区分工具检查、Mac原生验证和Windows原生验证。没跑的一项明确写待验证，不用静态校验代替双端实测。

Windows PowerShell示例：`node .\scripts\new-pack.mjs "$HOME\Desktop\MyPack" --author "作者"`。其余命令同样使用Node，输出路径换成自己的新目录即可。

可先运行 `node scripts/smoke-test.mjs` 验证本机工具链。它只使用临时目录，自动清理，不读写用户功德或已安装形象。

## 分享与投稿

制作、导入不要求投稿。作者希望分享作品时，读取 [投稿入口与版本更新](references/submission-and-updates.md)。官网的 Skill 下载区同时提供投稿协议及确认按钮，通过抖音群联系管理员人工提交。投稿及适配版统一免费，不包含默认二创收费授权。使用 Skill、下载或入群不视为同意投稿协议；请由作者本人勾选确认，不代其同意或发送消息。

## 身份与边界

- 默认使用 `diy.*` 和作者自己的稳定publisher，review_id=local，无license。official./zqscreen./creator.为保留身份。
- `check-pack --source`是平台制作源包诊断；`--submission`是暂停中的历史投稿格式诊断，均不意味着直接可导入或投稿开放。平台包仍验证原有签名；本Skill不提供签发或绕过方法。
- 不修改已发布签名包后沿用原版号，不自动修复现有用户文件。新增客户端能力时同步修改格式、两端实现、模板与工具，并更新绑定；不为了适应一份失败素材放宽安全读取。

## 分发

脚本随源代码分发，沿用本项目附带的 [GPLv3 许可证](LICENSE)。模板是本Skill的程序生成示例；不包含官方付费形象、私钥或客户端二进制。
