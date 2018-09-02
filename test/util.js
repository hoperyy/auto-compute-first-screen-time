function getImgSrcFromBgImg(bgImg) {
    var imgSrc;
    // bgImg maybe like: '-webkit-cross-fade(url("http://si.geilicdn.com/hz_img_0eac000001604a2739c40a026860_336_336_unadjust.png"), url("http://si.geilicdn.com/bj-pc-331569480-1508461443422-795323868_2976_3968.jpg.webp?w=400&h=400&cp=1"), 0.488091)'
    var matches = bgImg.match(/url\(.*?\)/g);

    if (matches && matches.length) {
        var urlStr = matches[matches.length - 1]; // use the last one
        var innerUrl = urlStr.replace(/^url\([\'\"]?/, '').replace(/[\'\"]?\)$/, '');

        if (((/^http/.test(innerUrl) || /^\/\//.test(innerUrl)))) {
            imgSrc = innerUrl;
        }
    }

    return imgSrc;
}

[
    '-webkit-cross-fade(url("http://si.geilicdn.com/hz_img_0eac000001604a2739c40a026860_336_336_unadjust.png"), url("http://si.geilicdn.com/bj-pc-331569480-1508461443422-795323868_2976_3968.jpg.webp?w=400&h=400&cp=1"), 0.488091)',

    'url(//si.geilicdn.com/bj-pc-331569480-1508461443422-795323868_2976_3968.jpg.webp?w=400&h=400&cp=1)',

    'url("//si.geilicdn.com/bj-pc-331569480-1508461443422-795323868_2976_3968.jpg.webp?w=400&h=400&cp=1")',

    `url('//si.geilicdn.com/bj-pc-331569480-1508461443422-795323868_2976_3968.jpg.webp?w=400&h=400&cp=1')`
].forEach(function(bgImg) {
    console.log('');
    console.log(getImgSrcFromBgImg(bgImg));
});
