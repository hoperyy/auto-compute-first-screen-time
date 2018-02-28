*[中文文档](./README_zh.md)*

**Status: beta**

## What is this ?

A tool for auto computing first screen time of one page.

## What's the defination of *first screen time* ?

+   If there are images existing in first screen, the defination is: `the-time-at-which-all-images-in-first-screen-are-downloaded  -  window.performance.timing.navigationStart`
+   If there is no image existing in first screen, the defination is: `the-time-at-which-dom-changes-no-more  -  window.performance.timing.navigationStart`

## Precision

the distance betwwn average tested time and real first screen time is less than 100ms (tested in wifi/fast 3G/slow 3G)

## How To Use

run this code before the scripts of page run.

```
require('auto-compute-first-screen-time')({
    xhr: {
        /*
         * the xhr request that 'auto-compute-first-screen-time' will catch for computing data returning time; RegExp Required;
         * example: [/mtop\.alibaba\.com/i]
         */
        limitedIn: [],

        /* the xhr request that 'auto-compute-first-screen-time' will not catch for computing data returning time; RegExp Required;
         * example: [/list\.alibaba\.com/i]
         */
        exclude: []
    },

    // callback after first screen was got
    onTimeFound: function (result) {
        /* 
         * result.finishedTime: The time at which first screen finished
         * result.lastedTime: The time that first screen costs
         * result.maxErrorTime: The max error time than real time
         */

        // for first screen time that is less than 3s (fast page), the max error time limited in 200ms can be received because the page is fast
        if (result.finishedTime <= 3000) {
            if (result.maxErrorTime <= 200) {
                // report
            }
        } else { // for slow page, any error time can be received because the page is so slow that specific time is not neccessary.
            // report
        }
    }
});

// other scripts of current page
// ...
```

## LICENSE

BSD