const { HttpsProxyAgent } = require('https-proxy-agent');

const proxyList = [];

function getRandomAgent() {
  if (proxyList.length === 0) return null;
  return new HttpsProxyAgent(proxyList[Math.floor(Math.random() * proxyList.length)]);
}

module.exports = { getRandomAgent };
