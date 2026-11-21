# 首页地球轮廓

`earthLand.json` 来自 Natural Earth 1:110m land，仅保留陆地外形及内环，不含国界或行政信息。

- 原始数据：https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
- 许可：https://www.naturalearthdata.com/about/terms-of-use/ （Public Domain）
- 处理：Douglas–Peucker 简化至 0.25°，经纬度保留两位小数，共 127 个多边形、2804 个点。
- 用途：本地栅格化为球体纹理；简化的自然色、云层、月面陨石坑及轨道仅用于艺术表现，不表示实时卫星影像或天文星历。

数据随前端源码分发，访问首页不请求外部地图，也不获取用户位置。
