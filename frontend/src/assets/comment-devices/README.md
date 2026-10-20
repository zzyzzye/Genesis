# 评论设备品牌素材

2026-10-20 固定本地副本，由 CommentDeviceIcon 引用；不运行时调用图标 API 或第三方图片服务。
保留上游路径、曲线、渐变与宽高比，以独立图片隔离 SVG 渐变 ID，避免多条评论的同名 ID 相互覆盖。品牌原色包含 Apple 等单色标识，不强行为所有品牌上色。

## 来源

- **SVG Logos**（Gil Barbara，CC0）：https://github.com/gilbarbara/logos 。通过 Iconify logos 集合取得，快照 lastModified=1792341236。
- **theSVG Color**（thesvg.org，MIT）：https://github.com/glincker/thesvg 。通过 Iconify thesvg-color 集合取得，快照 lastModified=1792131767；许可完整保留在 THE-SVG-LICENSE.txt。
- **Browser Logos**（MIT；品牌商标属于各自所有者）：https://github.com/alrra/browser-logos/tree/58881b84c4d73adc03c06fa2c275a7abee02d935 。UC 与 IE 使用该固定提交的原始 SVG，许可见 BROWSER-LOGOS-LICENSE.txt。
- **Operating System Logos**（MIT）：https://github.com/ngeenx/operating-system-logos/tree/26fa244ed86397ccb62bb5e6e47b364768add2c6 。Tizen、webOS、Symbian 使用原库 64×64 PNG，原像素不变，以 SVG 包装 data URI 便于文本补丁审查；并非重新描摹的矢量。许可见 OS-LOGOS-LICENSE.txt。
- **Windows 7 时代彩色旗**：https://commons.wikimedia.org/wiki/File:Unofficial_Windows_logo_variant_-_2002%E2%80%932012_(Multicolored).svg ，Codename Lisa 衍生图形，来源页标注 PD-textlogo/public domain；增加 viewBox，图形和配色不变。它是社区整理的时代标识，不声称为微软官方分发文件。
- **QQ Browser**：https://browser.qq.com/ 官网展示的 https://m4.publicimg.browser.qq.com/publicimg/nav/pchome/qblogo.png ，334×66；原像素不变，仅以 SVG viewBox 展示左侧 66×66 图形标志，去除文字标志。品牌图形归腾讯所有，仅用于来源识别，不使用 QQ 即时通讯企鹅代替 QQ 浏览器。

Kylin 名称可能代表多个不同发行版，现有识别资料不能确认对应品牌时用通用系统图形；不拿 Apache Kylin 或 Ubuntu Kylin 标识冒充。未收录品牌及资源加载失败也使用通用图形，并保留服务端名称与版本文字。

| 本地文件 | 上游图标 |
| --- | --- |
| android.svg | logos:android-icon |
| arch.svg | logos:archlinux |
| centos.svg | logos:centos-icon |
| debian.svg | logos:debian |
| fedora.svg | logos:fedora |
| bsd.svg | logos:freebsd |
| mint.svg | logos:linux-mint |
| linux.svg | logos:linux-tux |
| suse.svg | logos:suse |
| ubuntu.svg | logos:ubuntu |
| windows.svg | logos:microsoft-windows-icon |
| chrome.svg | logos:chrome |
| firefox.svg | logos:firefox |
| edge.svg | logos:microsoft-edge |
| safari.svg | logos:safari |
| brave.svg | logos:brave |
| vivaldi.svg | logos:vivaldi-icon |
| opera.svg | logos:opera |
| windows10.svg | thesvg-color:windows8 |
| chromium.svg | thesvg-color:chromium |
| samsung.svg | thesvg-color:samsung-browser |
| yandex.svg | thesvg-color:yandex |
| deepin.svg | thesvg-color:deepin |
| kali.svg | thesvg-color:kali-linux |
| harmony.svg | thesvg-color:harmonyos |
| openbsd.svg | thesvg-color:openbsd |
| netbsd.svg | thesvg-color:netbsd |
| blackberry.svg | thesvg-color:blackberry |
| kaios.svg | thesvg-color:kaios |
| macos.svg、ios.svg | logos:apple |
| windows7.svg | Commons，见上文 |
| uc.svg | src/uc/uc.svg |
| ie.svg | src/archive/internet-explorer_9-11/internet-explorer_9-11.svg |
| tizen.svg、webos.svg、symbian.svg | src/64x64/TIZ.png、WOS.png、SYM.png |
| qq.svg | QQ Browser 官网 qblogo.png，仅展示图形部分 |

本目录的项目许可不替代各品牌的商标权。本次收集只用于评论中的系统和浏览器识别，不代表品牌背书。
