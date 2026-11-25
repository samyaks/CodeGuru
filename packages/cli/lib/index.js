'use strict';

module.exports = {
  ...require('./schema'),
  ...require('./parse'),
  ...require('./validate'),
  ...require('./migrate'),
  ...require('./generate'),
  ...require('./sync'),
};
