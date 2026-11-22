# HKMO 题目配图处理规则

适用于给 HKMO 系列的题目配图（把卷面上的 Figure 裁出来挂到题面里）。MO23 / MO24 是第一批，其余年份按同一套规则推进。

## 一、题号怎么读

```
MO + 两位年份码 + 环节 + 序号
```

| 环节 | 含义 | 序号语义 |
|---|---|---|
| `HI` | Heat Individual（初赛个人） | **等于卷面题号**：`MO23HI06` = heat 第 6 题 |
| `HG` | Heat Group（初赛团体） | 同上：`MO23HG05` = heat 的 G5 |
| `FI` | Final Individual（决赛个人） | **4 题 × 4 小问流水号**，见下 |
| `FG` | Final Group（决赛团体） | 同上 |

年份码：`23` = 2023-24 赛季，`24` = 2024-25 赛季。卷子文件名对应 `HKMO2023heatans.pdf` / `HKMO2023finalans.pdf` 等。

**FI 的序号换算是流水号**：

```
序号 n  ->  卷面第 ⌈n/4⌉ 道大题，第 ((n-1) mod 4 + 1) 个小问
```

例：

```
MO23FI01 → I1.1      MO23FI03 → I1.3      MO23FI05 → I2.1
```

**FG 段不能套这个公式。** 题库的 FG 条数可能少于卷面的小题数（2023 只有 13 条，
而卷面有 G1.1–G4.4 共 16 个），缺了条目之后整段就错位了：

```
2023-24 实际映射（缺 G1.1–G1.3，所以整体左移 3 位）：
  FG01=G1.4   FG02=G2.1   FG03=G2.2   FG04=G2.3   FG05=G2.4
  FG06=G3.1   FG07=G3.2   FG08=G3.3   FG09=G3.4   ← 不是 G3.1
  FG10=G4.1   ...        FG13=G4.4
```

**所以 FG/YI 这类段必须先核对内容再定位**：把题目的 `statement` 拿去和卷面正文
逐条比对，确认是第几大题第几问，然后才去找图。只按序号推，会把 G3.1 的题配上
G3.4 的图，而且看不出错。

`HG` / `HI` 的序号等于卷面编号，不受影响（但要留意题库可能少收几题，
比如 2023 的 HI 只到 15，卷面有 16 题）。

卷面正文里每道大题有标题 `Individual Event 1`，下面标 `I1.1`、`I1.2`……

## 二、哪些题需要图

三个信号，任一命中就要看：

1. `tags` 含 `need-img`
2. 题面里有 `In Figure N` / `In the following figure` / `as shown in the figure` / `the diagram on the right`
3. `public !== true`（悬而未决的题基本都在等图）

反过来，**题面没提 figure 的不要硬配图**。有些题是纯代数，配图反而干扰。

## 三、找图

### 3.1 定位到页

```powershell
cd C:\moj
node temp/pdf-render.mjs "private\HKMO problems\twhung78.github.io-main\HKMO\HKMO2023heatans.pdf" 1-8 2
```

输出在 `temp/pdf-pages/`，文件名形如 `HKMO2023heatans-p003.png`。用 `read_image` 逐页看。

卷子结构：**第 1 页是答案表**，之后是正文。正文按 `Individual Event N` / `Group Event N` 分节。

### 3.2 裁图

用 HA 那套工具，它接受任意 PDF：

```powershell
# 先渲染整页看位置
node temp/ha-page.mjs render "2023heatans.pdf" 3

# 按坐标裁（坐标是渲染图上的像素坐标）
node temp/ha-page.mjs cut MO23HI06 "2023heatans.pdf" 3 500,300,700,500
```

如果图里有字母标签（A/B/C…），可以用自动定位：

```powershell
node tools/ha-crop.mjs --text="2023heatans.pdf:3"     # 打印该页每个文字的坐标
```

**坐标系换算**：`read_image` 显示的预览宽度一般是 1089px，而实际渲染图是 1786px 宽，比例 **1.64**。按预览估的坐标要乘 1.64。这个坑很常见。

### 3.3 裁剪标准

**要**：图形全部内容、所有点、所有线、所有字母标签、阴影填充。

**不要**：题目文字（中英文都不行）、页眉页脚（`HKMHASC 2023`、`P. 3`）、下一题的题号、大块空白（留 10–20px 边距）。

**必须 `read_image` 确认**。典型的失败是标签被切掉一半、或者顶部带进一行文字。第一版几乎总要调 2–3 次。

## 四、命名与上传

文件名：`<题号>-1.jpg`，放在 `images/problems/` 下。

```powershell
node --env-file=.env temp/upload-ha-figure.mjs MO23HI06
```

这个脚本会：

1. 把 `temp/ha-figures/MO23HI06-1.jpg` 传到 GitHub `wyk-math-team/static` 仓库
2. 返回 jsDelivr 链接
3. 在题目的 `statement` 末尾追加一段 `<img>`

追加的标签格式（与已有的 90 道 HA 题一致）：

```html
<img src="https://cdn.jsdelivr.net/gh/wyk-math-team/static@main/images/problems/MO23HI06-1.jpg" alt="problem image" loading="lazy" style="max-width:66.67%;width:100%;height:auto;display:block;margin:.6rem auto;" />
```

**注意**：脚本读的是 `temp/ha-figures/<题号>-1.jpg`。如果裁出来的文件名不同，先改名或改脚本。

如果 statement 里已经有 `<img>`，脚本会跳过 —— 重复跑是安全的。

## 五、设为 public

配好图（或确认不需要图）之后：

```js
db.collection('problems').updateOne({ id: 'MO23HI06' }, { $set: { public: true } })
```

**判断标准**：

- 需要图的题：**图配好了才设 public**
- 不需要图的题：直接设 public
- 图确实截不出来（扫描件太糊、图形不完整）：**保持 private**，在汇报里说明原因

## 六、检查清单

每道题改完核对：

- [ ] `statement` 里有且仅有一个 `<img>`
- [ ] 图片 URL 用 curl 或浏览器打开是 200
- [ ] `read_image` 看过裁出来的图，内容完整、无文字混入
- [ ] `public: true`
- [ ] 不需要图的题没被硬塞图

整批做完后跑一次对账：

```powershell
node temp/audit-2324.mjs
```

## 七、已知的坑

**jsDelivr 偶尔 404**。文件在 GitHub 上但 CDN 没索引到。判断：`raw.githubusercontent.com` 通、`cdn.jsdelivr.net` 404，就是 CDN 问题。**换文件名最快**（`-1.jpg` → `-2.jpg` 并改 statement），不必反复上传同一路径。

**坐标比例**。见 3.2，预览 1089px vs 实际 1786px，乘 1.64。

**FI/FG 的序号**。不是卷面题号，是流水号。算错了会配错题。

**别改题面里的数学内容**。只追加 `<img>`，其他一个字都不动。发现题面有错（比如数字丢了、公式坏了）单独报告，不要顺手改。

## 八、汇报格式

- 处理了哪些 PDF
- 配成了几道（题号 + PDF 页 + 卷面编号）
- 设了几道 public
- 哪些截不出来、为什么
- 有没有发现题面错误
