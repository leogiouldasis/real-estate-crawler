require('dotenv').config()
// puppeteer-extra is a drop-in replacement for puppeteer,
// it augments the installed puppeteer with plugin functionality.
// Any number of plugins can be added through `puppeteer.use()`
const puppeteer = require("puppeteer-extra");
const cheerio = require("cheerio");
// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
const StealthPlugin = require("puppeteer-extra-plugin-stealth")
puppeteer.use(StealthPlugin())
const logger = require('./helpers/logger');

// Mongo Connection
const MongoClient = require('mongodb').MongoClient;
let mongoDbUrl = `${process.env.MONGODB_URI}`;
let mongo_db;
MongoClient.connect(mongoDbUrl, { useNewUrlParser: true, useUnifiedTopology: true }, function (err, db) {
    if (err) {
        logger.error(err);
    } else {
        mongo_db = db.db();
        logger.info('Mongo connected ' + mongoDbUrl)
    }
});

// Add plugin to anonymize the User-Agent and signal Windows as platform
const UserAgentPlugin = require("puppeteer-extra-plugin-anonymize-ua")
puppeteer.use(UserAgentPlugin({ makeWindows: true }))
try {
    console.time('ProcessTime')
    // That's it, the rest is puppeteer usage as normal 😊
    puppeteer.launch({ headless: true, args: ['--no-sandbox'] }).then(async browser => {
        let counter = 1;
        const page = await browser.newPage()
        await page.setViewport({ width: 1280, height: 800 })
        // To ensure Amazon doesn't detect it as a Bot
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8'
        });
        await page.setRequestInterception(true);
        const block_ressources = ['image', 'stylesheet', 'media', 'font', 'texttrack', 'object', 'beacon', 'csp_report', 'imageset'];
        page.on('request', request => {
            //if (request.resourceType() === 'image')
            if (block_ressources.indexOf(request.resourceType) > 0)
                request.abort();
            else
                request.continue();
        });
        for (let index = 1; index < 100; index++) {
            await page.goto('https://www.xe.gr/property/search?Transaction.type_channel=117518&page=' + index + '&per_page=50')
            // await page.goto('https://www.xe.gr/property/search?Geo.area_id_new__hierarchy=82486&System.item_type=re_residence&Transaction.type_channel=117518&page=13&per_page=10');
            logger.info('Waiting for Selector');
            await page.waitForSelector('.pager');
            let content = await page.content();
            let $ = cheerio.load(content);

            if ($("title").text() === 'Pardon Our Interruption') {
                logger.error('Blocked');
            } else {
                logger.info('Found Content on Page:' + index);
            }
            let data = [];
            $('div.lazy').each(function () {

                // Get data from href
                let hrefData = $(this).find('a').text();
                hrefData = hrefData.trim().replace('τ.μ.', '').split(' ');
                let area = '';
                for (let index = 2; index < hrefData.length; index++) {
                    area += hrefData[index] + ' ';
                }

                // Check if professional or not
                isProfesssional = $(this).find('.pro_action_hotspot').attr('href') || false;
                
                let ad = {
                    _id: $(this).data('id'),
                    area_full: $(this).data('area'),
                    href: $(this).find('a').attr('href'),
                    type: hrefData[0],
                    tm: hrefData[1],
                    area: area.trim(),
                    is_professional : isProfesssional ? 'yes' : 'no',
                    professional_link: isProfesssional || '',
                };

                // console.log(ad)

                data.push(ad);
                counter += 1;
            });
            for (let index = 0; index < data.length; index++) {
                await mongo_db.collection('xe_ads').save(data[index]);
            }
        }

        logger.info('Crawled:' + counter);
        await browser.close();
        console.timeEnd('ProcessTime')
    })
} catch (error) {
    console.log(error)
}