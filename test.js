const https = require('https');

const url = 'https://frontend-api-v3.pump.fun/coins/latest';

https.get(url, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const parsedData = JSON.parse(data);
      console.log(JSON.stringify(parsedData, null, 2));
    } catch (err) {
      console.error('Error parsing JSON:', err);
    }
  });
}).on('error', (err) => {
  console.error('Error: ' + err.message);
});
