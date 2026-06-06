const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('../../config.json');

let cachedToken = null;
let tokenExpiresAt = 0;

function getAccessToken() {
  return new Promise((resolve, reject) => {
    if (cachedToken && Date.now() < tokenExpiresAt) {
      resolve(cachedToken);
      return;
    }
    const { app_id, app_secret } = config.wechat;
    if (!app_id || !app_secret) {
      reject(new Error('wechat.app_id and wechat.app_secret must be set in config.json'));
      return;
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${app_id}&secret=${app_secret}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.access_token) {
          cachedToken = json.access_token;
          tokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;
          resolve(cachedToken);
        } else {
          reject(new Error(`Token error: ${JSON.stringify(json)}`));
        }
      });
    }).on('error', reject);
  });
}

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    getAccessToken().then(token => {
      const url = new URL(`https://api.weixin.qq.com${path}`);
      url.searchParams.set('access_token', token);
      const data = JSON.stringify(body);
      const req = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, (res) => {
        let buf = '';
        res.on('data', chunk => buf += chunk);
        res.on('end', () => {
          const json = JSON.parse(buf);
          if (json.errcode && json.errcode !== 0) {
            reject(new Error(`API error ${json.errcode}: ${json.errmsg}`));
          } else {
            resolve(json);
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    }).catch(reject);
  });
}

function uploadImage(imagePath) {
  return new Promise((resolve, reject) => {
    getAccessToken().then(token => {
      const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`;
      const boundary = '----FormBoundary' + Date.now();
      const fileContent = fs.readFileSync(imagePath);
      const fileName = path.basename(imagePath);
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: image/${path.extname(imagePath).slice(1)}\r\n\r\n`),
        fileContent,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }, (res) => {
        let buf = '';
        res.on('data', chunk => buf += chunk);
        res.on('end', () => {
          const json = JSON.parse(buf);
          if (json.errcode && json.errcode !== 0) {
            reject(new Error(`Upload error ${json.errcode}: ${json.errmsg}`));
          } else {
            resolve(json);
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    }).catch(reject);
  });
}

function publishDraft(title, htmlContent, digest, thumbMediaId) {
  const body = {
    articles: [{
      title,
      content: htmlContent,
      digest: digest || '',
      thumb_media_id: thumbMediaId || '',
      need_open_comment: 1,
      only_fans_can_comment: 0
    }]
  };
  return apiPost('/cgi-bin/draft/add', body);
}

function getArticleTotal(startDate, endDate) {
  const body = {
    begin_date: startDate,
    end_date: endDate
  };
  return apiPost('/datacube/getarticletotal', body);
}

module.exports = { getAccessToken, apiPost, uploadImage, publishDraft, getArticleTotal };
