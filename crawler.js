const axios = require('axios')
const cheerio = require('cheerio')

class xeCrawler {

  constructor(url) {
    this.url = url
  }

  async loadHTMLFromURL() {
    console.log(this.url);
    const response = await axios.get(this.url)
    return response.data
  }

  async loadHtmlData() {
    const responseHtml = await this.loadHTMLFromURL()
    this.parsedHtml = cheerio.load(responseHtml)
  }


  getPageHeader() {
    return this.parsedHtml('#firstHeading').text()
  }

  getOnlyParentTextFromTOC(element) {
    return element.split('\n')[0]
  }

  getPageTOC() {
    return this.parsedHtml('.toclevel-1')
      .map((idx, element) => {
        return this.getOnlyParentTextFromTOC(this.parsedHtml(element).text())
      })
      .get()
  }


}

module.exports = xeCrawler