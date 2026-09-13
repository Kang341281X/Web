// PostCSS 配置：只挂 autoprefixer。
//
// 目标浏览器完全由 package.json 的 browserslist 字段决定（最新两版 Chrome / Firefox / Edge），
// autoprefixer 据此计算需要补的前缀（如 -webkit- / -moz-）。目标一改，前缀会自动增减，
// 不需要在样式里手工维护，也不会为不在目标内的浏览器输出无用前缀。
//
// Vite 会自动加载本文件，vite.config.js 中无需再写 css.postcss 选项。
// 生产构建与开发服务器都会生效；源码里的 CSS 保持无前缀写法即可。
export default {
  plugins: {
    autoprefixer: {},
  },
}
