const axios = require('axios');
const cheerio = require('cheerio');

const extractTextFromURL = async (url) => {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    return $('body').text().replace(/\s+/g, ' ').trim();
  } catch (err) {
    console.error('Error extracting text from URL:', err);
    throw err;
  }
};

module.exports = { extractTextFromURL };
