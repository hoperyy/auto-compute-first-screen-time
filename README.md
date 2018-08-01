## What is this ?

A tool for computing first screen time of one page with inaccuracy less than 250ms automatically.

## What's the defination of *first screen time* ?

+   If there are images existing in first screen, the defination is: 

    ```
    the time when all images in first screen loaded.
    ```

+   If there is no image existing in first screen, the defination is:

    ```
    window.performance.timing.domContentLoadedEventStart
    ```

## Precision

the distance between average tested time and real first screen time is less than 200ms (tested in wifi/fast 3G/slow 3G)

## How To Use

+   compute first screen time automatically

    Run this code before the scripts of page running.

    ```javascript
    var autoComputeFirstScreenTime = require('auto-compute-first-screen-time');
    
    autoComputeFirstScreenTime({

        // required: false
        request: {
            /*
             * the request that will be caught for computing first screen time;
             * RegExp in Array Required;
             * example: [/mtop\.alibaba\.com/i]
             */
            limitedIn: [],

            /* 
             * the request that won't be caught for computing first screen time;
             * RegExp in Array Required;
             * example: [/list\.alibaba\.com/i]
             */
            exclude: []
        },

        // required: false
        onTimeFound: function (result) {
            if (result.success) {
                console.log(result.firstScreenTime)
            } else {
                console.log(result);
            }
        }
    });

    // other scripts of current page
    // ...
    ```

+   compute first screen time by hand when you find it ready

    ```javascript
    var autoComputeFirstScreenTime = require('auto-compute-first-screen-time');

    autoComputeFirstScreenTime.report({

        // required: false
        onTimeFound: function (result) {
            if (result.success) {
                console.log(result.firstScreenTime)
            } else {
                console.log(result);
            }
        }
    });
    ```

+   Dom control

    +   `perf-ignore`

        ignore images inside the tagged dom (tagged dom included)

        ```html
        <div>
            <img src="xxx" />
        </div>
        <div perf-ignore> <!-- ignored -->
            <img src="xxx" /> <!-- ignored -->
        </div>

        <div perf-ignore style="background: url(xxx) 0 0 no-repeat;"></div> <!-- ignored -->
        ```

    +   `<body perf-random="0.2"></body>`

        the chance of current page will compute first screen time. `1` by default.

        as this example, the chance with 20% of current page will compute first screen time;

    +   `<body perf-dot></body>`

        force computing first screen time by dotting. (as [Details](https://github.com/hoperyy/auto-compute-first-screen-time#details) below)

## Support xhr ?

Yes!

## Support fetch ?

Yes!

## Details

![details](imgs/2018-07-30-11-35-25.png)

## TODO

+   Tests

## LICENSE

BSD