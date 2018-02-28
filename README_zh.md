**状态: 测试版**

## 这是什么

自动计算首屏时间的小工具（beta）

## 首屏时间定义

如果首屏有图片，定义为：“首屏所有图片加载完毕的时刻” 和 “跳转到当前页” 到  两个时刻的差值。

如果首屏没有图片，定义为：一段时间内（保证首屏渲染完毕），“最后一次 DOM 变动的时刻” 和 “开始调到到当前页” 两个时刻的差值。

## 和手动埋点相比，误差是多少

经过各种测试，和真实的首屏时间相比误差在 200ms 以内（wifi/fast 3G/slow 3G）

## 如何使用

在页面代码执行前，运行如下代码

```
require('auto-compute-first-screen-time')({
    xhr: {
        /*
         * 只监听该数组内的 xhr 请求
         * 子项的格式为正则
         * 举例: [/mtop\.alibaba\.com/i]
         */
        limitedIn: [],

        /*
         * 不抓取的 xhr 的请求
         * 子项的格式为正则
         * 举例: [/list\.alibaba\.com/i]
         */
        exclude: []
    },

    // 首屏时间计算完成后的回调函数
    onTimeFound: function (result) {
        /*
         * result.finishedTime: 首屏完成的时刻（ms）
         * result.lastedTime: 首屏花费的时间（ms）
         * result.maxErrorTime: 最大误差时间（ms）
         */

        // 对于首屏时间少于 3s 的页面（较快），可以接受的误差值最好在 200ms 以内，否则误差就过大了，然后上报数据
        if (result.lastedTime <= 3000) {
            if (result.maxErrorTime <= 200) {
                // report
            }
        } else { // 对于首屏时间大于 3s 的页面，可以接受任何误差，因为页面本身就很慢，无需获取精确的首屏时间
            // report
        }
    }
});

// 页面其他代码
// ...
```

## LICENSE

BSD