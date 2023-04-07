const moment = require('moment');

const momentDurationFormatSetup = require("moment-duration-format");

momentDurationFormatSetup(moment);


let x = moment("2008-12-28T12:46:57+08:00")
let y = moment()
let r = moment.duration(y.diff(x)).format("y [年] M[月] d[天]")

console.log(r)
