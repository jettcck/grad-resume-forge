# 第三方数据与组件声明

本应用（简历锻造炉 / GradResume Forge）本体以 MIT 协议发布。下面是随包分发或运行期使用的第三方内容。

---

## 1. 中国城市 / 区县坐标数据

- **来源**：https://github.com/88250/city-geo
- **协议**：木兰宽松许可证，第 2 版（Mulan PSL v2）—— 完整协议原文见
  [`third-party/city-geo-LICENSE.txt`](third-party/city-geo-LICENSE.txt)
- **上游说明**：该仓库整理中国城市县区的经纬度数据，坐标由其使用百度地图 API 补齐，
  原始动机是实现「按日出日落自动切换深色模式」，因此**不是**为导航精度准备的数据集。
- **本应用的使用方式**：取其 `data.json` 中 `area` 为空的城市级记录与区县级记录，
  在构建期用标准算法把坐标从 GCJ-02 转换为 WGS-84，生成
  [`src/renderer/city-geo.js`](src/renderer/city-geo.js)。
  转换脚本不随包分发，生成结果内保留了来源与坐标系判定依据的注释。
- **坐标系判定依据**：上游坐标相对权威 WGS-84 参照点的偏移量（例如北京东城区约
  `+0.0063°/+0.0064°`）明显小于 BD-09 所需量级（约 `+0.011°/+0.0126°`），符合 GCJ-02 特征。
  转换后与权威地标比对：北京 / 上海 / 广州 / 深圳 / 成都 / 乌鲁木齐 / 三亚 偏差 0.6–1.3km，
  杭州 5.8km、哈尔滨 10.0km、拉萨 5.1km（后三者是政府驻地与所选地标本身就相距那么远）。
- **精度声明**：城市级点多为政府驻地或城区质心，与具体某栋楼相差 5–10km 属正常；
  区级点误差通常 1–3km。本应用在界面上如实标注「城市中心近似坐标」，
  并提供「地图点选 / 手动填经纬度」以获得精确位置。
- **本项目对数据的修改**：仅做坐标系换算（GCJ-02 → WGS-84）、行政区后缀归一化、
  JSON 到 JS 对象字面量的序列化；未修改任何坐标数值本身。

## 2. 地图瓦片（运行期，可选功能）

地图是**可选**功能。不开启时应用不发起任何地图相关网络请求。

| 瓦片源 | 地址 | 坐标系 | 版权署名 |
|---|---|---|---|
| OpenStreetMap | `tile.openstreetmap.org` | WGS-84 | © OpenStreetMap contributors |
| OSM 德国镜像 | `tile.openstreetmap.de` | WGS-84 | © OpenStreetMap contributors |
| 高德地图 | `webrd0{1-4}.is.autonavi.com` | GCJ-02 | © 高德地图 |
| 自定义 | 由用户填写（必须 https、不得指向内网） | 用户声明 | 由用户负责 |

- **OpenStreetMap**：瓦片数据 © OpenStreetMap contributors，以
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) 授权。本应用在界面内展示其署名，
  并通过主进程设置可识别的 User-Agent、限制单块体积、做磁盘缓存以减少重复请求，
  符合其[瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)对低流量客户端的要求。
- **高德地图**：使用的是高德面向网页的公开瓦片服务，**不是**官方开放 API，
  仅供个人低频率查看使用，请勿高频抓取或用于商业分发。界面内已如实注明。
- **自定义源**：由用户自行填写并自行承担相应服务条款；主进程只做安全校验
  （必须 https、不得指向内网 / 本机），不保证其可用性与合法性。

## 3. 运行期依赖

见 [`package.json`](package.json) 的 `dependencies`：

- `@mlc-ai/web-llm`（Apache-2.0）—— 应用内模型（WebGPU）
- `pdfjs-dist`（Apache-2.0）—— PDF 简历导入
- `electron-updater`（MIT）—— 自动更新

开发依赖与传递依赖以 `package-lock.json` 为准。
