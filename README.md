# canvas-render

在浏览器里把 Obsidian 的 `.canvas` 文件渲染成接近 Obsidian 的样子。

文件格式是 [JSON Canvas](https://jsoncanvas.org)——Obsidian 官方发布的开放规范，MIT 许可。Obsidian 自己的渲染代码没有独立模块，整段压缩在 `obsidian.asar` 的 `app.js` 里，并且依赖 Obsidian 内部的 Vault、Workspace、MarkdownRenderer 对象，抽不出来也跑不起来，所以这里按规范重新实现了一份。

## 运行

```bash
./serve.sh          # 默认 8000 端口，可传参数改端口
```

必须经过 web server：页面要 `fetch` 那个 `.canvas` 文件和它引用的 markdown，浏览器会拦截 `file://` 协议下的这类请求。

`serve.sh` 不是直接调 `python3 -m http.server`，而是覆盖了两个 MIME 类型：

```
.md      →  text/plain; charset=utf-8
.canvas  →  application/json; charset=utf-8
```

`.md` 这条是必需的。Python 默认发 `Content-Type: text/markdown`，不带 charset，Chrome 于是按 Latin-1 解码，点开标题看到的中文会是 `å®šä¹‰` 这样的乱码。**部署到其他服务器时要做同样的配置**，nginx 对应一行：

```nginx
types { text/plain md; }
charset utf-8;
```

## 参数与部署

渲染哪个 canvas 由 URL query 参数决定，一个必需一个可选：

| 参数 | 必需 | 含义 |
|---|---|---|
| `canvas` | 是 | `.canvas` 文件路径，相对于页面所在目录。不传时加载 `vault/demo.canvas` |
| `vault` | 否 | file 节点路径解析的 vault 根。默认取 `canvas` 文件所在的目录 |

两者都只接受同源相对路径。传入带协议的完整 URL 会直接报错停下，不会去取——这个应用不做跨站转发。

`vault` 之所以能默认推导：JSON Canvas 的 file 节点存的是 vault 根相对路径，而部署时最省事的布局是「一个 canvas 一个目录，canvas 文件就放在该目录的根上」，此时 canvas 所在目录正好就是 vault 根。本仓库的 `vault/` 就是这么一个目录：

```
vault/
├── demo.canvas                        ← canvas 在 bundle 根上
└── pages/Mathematics-数学/…            ← file 节点写的就是这个相对路径
```

对应链接是 `?canvas=vault/demo.canvas`，`vault` 参数可以省掉。

要在一个站点上放多个 canvas，就并列多个这样的目录，各自独立：

```
?canvas=math/board.canvas         →  vault 根 = math/
?canvas=roadmap/2026.canvas       →  vault 根 = roadmap/
```

只有 canvas 文件位于 vault 的子目录里时（在 Obsidian 里很常见，比如 canvas 放在 `boards/` 而笔记在 `pages/`），才需要显式写第二个参数，把根指回上层：

```
?canvas=notes/boards/plan.canvas&vault=notes/
```

漏写 `vault` 时的表现是：canvas 本身正常渲染，但每个 file 节点的卡片里显示「无法加载 …（HTTP 404）」——因为路径被解析到了 canvas 所在的子目录下。看到这个提示就说明该补 `vault` 参数了。

## 实现

### 为什么用 DOM + SVG，而不是 `<canvas>` 元素

这里的 canvas 指 Obsidian 的白板功能，和 HTML5 的 `<canvas>` 位图画布无关。节点内容是渲染后的 markdown，需要文字选中、独立滚动、KaTeX 排版，这些能力在位图画布里都得从头重写。所以结构是：

- 每个节点是一个绝对定位的 `div`，`left/top/width/height` 直接取 canvas 文件里节点的 `x/y/width/height`
- 卡片内部是 flex 纵向布局：标题行 `flex: none` 固定在顶端，内容区 `flex: 1` 吃掉剩余高度并独立滚动
- 所有边画在同一层 `<svg>` 里，`z-index` 压在节点之下
- `group` 类型的节点 `z-index: 0`，垫在最底层

Obsidian 本身也是这个结构：解包 `obsidian.asar` 后看 `app.css` 里的类名（`canvas-node`、`canvas-node-container`、`canvas-edges`、`canvas-path-end`）就能确认，本项目的类名沿用了这套命名。

### 平移与缩放

节点和边都装在同一个容器 `#canvas` 里，整体套一个变换：

```
transform: translate(view.x, view.y) scale(view.zoom)
```

屏幕坐标换算成画布坐标，就是这一行的逆运算：

```
画布坐标 = (屏幕坐标 - view.x) / view.zoom
```

以光标为锚点缩放（`zoomAt()`）的做法：先算出光标位置对应的画布坐标，改完 `view.zoom` 之后反解出新的 `view.x`、`view.y`，使同一个画布点仍然落在光标下。实测锚点漂移小于 0.001 画布像素。

点阵背景不在这个变换里——它铺满整个视口，靠 `background-size` 跟着 `view.zoom` 放大、`background-position` 取平移量对 `GRID_SIZE * view.zoom` 的模来对齐。放在变换里的话，缩小时点阵会露出边界。

### 边的形状

Obsidian 边线那种 S 形来自控制点的取法：三次贝塞尔曲线的两个控制点，分别从起止锚点沿**所在边的外法线方向**推出去一段。

```
锚点   = 节点某条边的中点
控制点 = 锚点 + 外法线 × offset
offset = max(EDGE_MIN_CONTROL_OFFSET, 两锚点距离 × EDGE_CONTROL_RATIO)
```

箭头是一个三角形，尖端压在节点边框上、朝向节点内部。它比线宽宽得多，会直接盖住线条末端，所以不需要把贝塞尔曲线截短——省掉了在曲线上求参数点的那步。

JSON Canvas 允许省略 `fromSide`/`toSide`。缺失时按两个节点中心的相对位置推断该从哪条边出入（`inferSide()`）：水平距离不小于垂直距离就走左右边，否则走上下边。

### markdown 渲染管线

原文不能直接交给 marked：公式里的 `_`、`*`、`\` 会被当作下标、强调和转义符处理，`\alpha` 会被吃掉。所以先做一次扫描，把四类互斥的片段分开：

```js
/(```…```|`…`)|\$\$…\$\$|\$…\$|\[\[…\]\]/g
```

正则的分支从左到右就是优先级：代码块和行内代码最优先，因此 `` `$x$` `` 保持字面量，与 Obsidian 一致；然后依次是块级公式、行内公式、wikilink。

处理顺序：

1. 公式替换成 `CANVASMATH<编号>ENDMATH` 形式的占位符。占位符只含字母和数字，不含任何 markdown 语法字符，marked 不会改动它
2. wikilink 直接替换成 `<a>` 标签。marked 会原样透传行内 HTML，所以不需要占位符
3. marked 解析全文
4. 按占位符编号回填 KaTeX 的渲染结果。块级公式若被 marked 包进了独立的 `<p>`，先把这层 `<p>` 去掉，否则块级元素 `katex-display` 会嵌在段落里

`[[ 1 ]](#cite_note-1)` 这类维基百科导入残留，会渲染成一个链接加一段字面文本。Obsidian 的结果也是这样，属于原文本身的问题。

### file 节点的内容加载

canvas 文件里存的是 vault 相对路径，例如 `pages/Mathematics-数学/形式导数.md`。部署目录按原样保留这个路径结构，再由上面那条规则算出 vault 根拼在前面，因此 canvas 文件一个字都不用改。

路径含空格和中文，编码时按 `/` 切开、逐段 `encodeURIComponent` 再拼回去。不能对整串用 `encodeURI`，那样路径里的 `#` 不会被编码，会被当成 URL 片段分隔符。

按扩展名分发：`.md` 进 markdown 管线，图片扩展名用 `<img>`，其余用 `<iframe>`。节点带 `subpath`（形如 `#某个标题`）时，先按标题层级把对应小节切出来再渲染。

## 用到的库

| 库 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 12.0.2 | markdown 解析，开了 GFM（表格、删除线） | MIT |
| [KaTeX](https://katex.org) | 0.16.11 | LaTeX 公式排版 | MIT |

两个库都内置在 `lib/` 下而不走 CDN，这样 demo 能离线打开——vault 本身就是本地的，渲染它却要联网说不过去。

KaTeX 只保留了 CSS 里实际引用的 20 个 woff2 字体（296 KB）。同名的 woff 和 ttf 回退格式没有下载：它们在 `@font-face` 的 `src` 列表里排在 woff2 之后，现代浏览器取到 woff2 就不会再请求后面的格式。

没有构建步骤，也没有 npm 依赖，`index.html` 用 `<script>` 和 `<link>` 直接加载这些文件。

## 可调参数

都在 `canvas-render.js` 顶部：

| 常量 | 默认值 | 作用 |
|---|---|---|
| `EDGE_CONTROL_RATIO` | 0.35 | 边线弯曲程度，调大更圆滑 |
| `ZOOM_WHEEL_SENSITIVITY` | 400 | 滚轮缩放灵敏度，调大更迟钝。一格鼠标滚轮（deltaY 120）对应 1.35 倍 |
| `GRID_SIZE` | 20 | 点阵间距，与 Obsidian 一致 |
| `MIN_ZOOM` / `MAX_ZOOM` | 0.1 / 3 | 缩放范围 |
| `FIT_MAX_ZOOM` | 1 | 「适应」时的放大上限，避免内容少时被放到失真 |
| `DEFAULT_CANVAS_PATH` | `vault/demo.canvas` | 未传 `?canvas=` 时加载的文件 |

## 目录

```
index.html          页面骨架
canvas-render.js    渲染器
canvas-render.css   Obsidian 风格样式，明暗双主题
lib/                marked 与 KaTeX
serve.sh            起本地 web server
sync-vault.sh       按 canvas 重新拷贝被引用的文件
vault/              示例 bundle：canvas 文件加它引用的 markdown
├── demo.canvas
└── pages/Mathematics-数学/…
```

上面六项是应用本身，`vault/` 是一份内容。部署时应用只需上传一次，之后每加一个 canvas 就并列加一个同构的目录。

在 Obsidian 里给 canvas 加了节点之后，部署目录下的副本不会跟着变，页面会因为取不到文件而显示加载失败。这时跑一次同步脚本，它按 canvas 里的引用重新拷贝到该 canvas 所在的目录：

```bash
./sync-vault.sh                                  # 默认：从 .. 同步到 vault/demo.canvas 边上
./sync-vault.sh ~/vault math/board.canvas        # 指定源 vault 和目标 canvas
```

文件在源 vault 里找不到会直接报错退出，不会静默漏掉。

## 支持范围

节点：`text`、`file`、`link`、`group`。
边：`fromSide`/`toSide`（可省略）、`fromEnd`/`toEnd` 箭头开关、`label`、`color`。
颜色：Obsidian 的六个预设色（`"1"`–`"6"`）和自定义十六进制值。

两点没有实现：

- 块引用子路径 `#^blockid`——会渲染整篇文档
- `[[wikilink]]` 只做样式，不能跳转

## 交互

拖动背景平移，拖动卡片正文则是选中文字；卡片内容超出高度时可以单独滚动。⌘/Ctrl + 滚轮或触控板双指捏合缩放，普通滚轮平移。左下角是缩放、适应、明暗主题按钮，主题选择存在 `localStorage`。

file 和 link 节点的卡片顶端有一行标题，画在**卡片内部**，样式对齐 Obsidian 的 `.embed-title`：正文字号、字重 600、单行超出省略。file 节点显示去掉 `.md` 后缀的文件名，link 节点显示 URL。text 节点没有标题栏；group 的名字在框线**上方**，那是 Obsidian 的 `.canvas-node-label`，也是唯一画在卡片外的标签。

标题是一个链接，点击在新标签页打开对应的 markdown 源文件（link 节点则打开它的 URL）。开新标签页是为了不丢掉当前画布的平移缩放位置。

可点击区域精确等于标题文字加尾部图标，而不是整行：标题行是 flex 项，会撑满卡片宽度，但里面的 `<a>` 是 `inline-flex`，只包住内容。实测一张 320px 宽的卡片，标题行 318px，可点击部分 82px；按在标题右侧空白处的行为和按在卡片其他地方一样——平移画布，不会跳转。

尾部那个外链图标不承担扩大命中区的作用，它只是提示「这一下会离开当前页」；单独拿图标当唯一入口反而更难点中。

标题链接和卡片正文一样被排除在拖拽平移之外（`startsPan()`），否则 `setPointerCapture` 会把指针事件劫持到画布上，点击落不到链接。

## 参考

- [JSON Canvas 规范](https://github.com/obsidianmd/jsoncanvas)
- [Obsidian 关于 JSON Canvas 的公告](https://obsidian.md/blog/json-canvas/)
