# 双端 0.9.5 的共同制作范围

适用源码与摘要见 `client-baseline.json`。版本号相同不代表实现相同；本 Skill 依据已发布的双端 0.9.5 及其绑定制作源码；其他版本请按对应能力核对。

## 默认本地 DIY

普通 ZIP 格式 `.nmgpack`，根目录只有 manifest.json、preview 和实际图层 PNG。使用 `diy.<作者>.<作品>` 唯一 ID，允许小写字母、数字、点、连字符，总长 3–80，不能以点开头或结尾。publisher/author 用作者自己的稳定名字或标识，review_id 为 local。无 license，无账号、联网或平台签名要求；不得使用 official./zqscreen./creator. 保留身份。相同作品升级沿用 ID 和 publisher，更新 version。

Schema 1 必须恰好有以下根字段：

```
schema_version, id, version, name_zh, name_en, author, publisher,
review_id, canvas_width, canvas_height, preview, plus_y, layers
```

canvas_width=240、canvas_height=250、plus_y=174。version 为 1–32 位字母/数字/点/下划线/连字符，字母或数字开头。可见名称、作者、发行者与 review_id 非空、无控制字符，制作工具限制不超过80字符且 UTF-8 不超过128字节，以兼容双方。不要添加 description、动作模式、FPS 等尚未定义的根字段。

## 图层与关键帧

每层恰好包含 image、frame、anchor、keyframes。Schema 3 再包含 interpolation，值 linear 或 smoothstep；每个关键帧再包含 scale_y。

| 字段 | 双端共同制作范围 |
|---|---|
| image / preview | 小写 PNG 根文件名，匹配 `[a-z0-9][a-z0-9_-]{0,59}.png` |
| frame | 四元组 `[x,y,width,height]`；x=-240..480、y=-250..480、width/height=1..480 |
| anchor | 两元组，两个值均为0..1 |
| t | 0..1，首帧0，float32转换后严格递增；单帧静止允许 |
| x / y | -480..480，逻辑单位，不是屏幕像素 |
| rotation | -180..180，角度 |
| scale | 0.1..4 |
| alpha | 0..1 |
| scale_y | 仅schema3，0.1..4，实际Y缩放为scale×scale_y |

Schema 1 使用线性插值；schema3按层选择插值。源图按 frame 放置，以 anchor 为局部缩放与旋转支点，再应用 x/y 平移。逻辑原点左下。Schema1的静态 frame 按工具的保守范围放在 y=0..170；schema3允许较大框，但可见内容仍受裁切，不能以该能力突破新作安全区。物体是否运动取决于关键帧之间的差异，不取决于偏移是否为零。

## 资源预算与工具边界

制作工具采用保守、便于分发的预算：封装8MiB、解压12MiB、manifest64KiB、总文件8个、图层6个、每层8关键帧，PNG单边2048，所有PNG（包括独立preview）RGBA等效解码总量64MiB。RGBA或RGB、8位、非隔行静态PNG；不支持APNG、GIF、SVG、字体、脚本、外链、子目录和符号链接。

这些是制作工具的保守范围，并非声称客户端所有限额都与它相同。客户端的运行缓存另有上限；极大纹理、过多半透明层和切换峰值仍需实际验证。工具通过不是性能合格证。

结构错误阻止封装；视觉体量、安全留白、采样包络与预览alpha差异为提示，必须按visual-standard.md进行人工复核。采样不能证明连续时间无越界；离线渲染器也不是原生颜色/滤镜一致性的判定器。

## 平台身份

--source 仅检查平台制作源包；--submission 仅检查历史投稿格式，均不授予签名、审核或作者身份。投稿仍暂停。本 Skill 不提供签发私钥、不改官方包、不绕过保留身份签名。默认 build-pack 仅构建普通本地包。
