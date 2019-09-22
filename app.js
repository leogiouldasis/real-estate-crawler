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
        const offset = process.env.WORKER_OFFSET;
        const limit = process.env.WORKER_LIMIT;
        const start = 1 + +offset;
        const finish = +start + +limit;
        const resultsPerPage = process.env.RESULTS_PER_PAGE;

        logger.info('Crawling from:'+start+ ' to:'+finish)

        for (let index = start; index < finish; index++) {
            const page = await browser.newPage()
            await page.setViewport({ width: 800, height: 600 })
            // To ensure XE doesn't detect it as a Bot
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8'
            });
            await page.setRequestInterception(true);
            const block_ressources = ['image', 'stylesheet', 'media', 'font', 'texttrack', 'object', 'beacon', 'csp_report', 'imageset'];
            page.on('request', request => {
                //if (request.resourceType() === 'image')
                if (block_ressources.indexOf(request.resourceType) > 0) {
                    request.abort();
                } else {
                    request.continue();
                }
            });
            let url = 'https://www.xe.gr/property/search?Transaction.type_channel=117518&page=' + index + '&per_page=' + resultsPerPage;
            url = 'https://www.xe.gr/property/search?System.item_type=re_residence&Transaction.type_channel=117518&per_page=10&Geo.area_id_new__hierarchy=82195';
            logger.info('Crawling:' +  url);
            await page.goto(url)
            logger.info('Waiting for Selector');
            await page.waitForSelector('.pager');
            let content = await page.content();
            let $ = cheerio.load(content);
            await page.close();

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
                const isProfesssional = $(this).find('.pro_action_hotspot').attr('href') || false;
                const price = $(this).find('.r_price').text().replace(/\D+/g, '');
                const tm = $(this).find('.r_stats :nth-child(2)').text().replace('τ.μ.', '').trim();
                const areaFull = $(this).data('area').split('>');
                
                let state = '';
                let nomos = '';
                let tomeas = '';
                if (areaFull[0].trim() === 'Νομός Αττικής') {
                    state = 'Στερεά Ελλάδα';
                    nomos = 'Νομός Αττικής';
                    tomeas = areaFull[1];
                } else if (areaFull[0].trim() === 'Ν. Θεσσαλονίκης') {
                    state = 'Μακεδονία';
                    nomos = 'Ν. Θεσσαλονίκης';
                    tomeas = areaFull[1];
                } else if (areaFull[0].trim() === 'Ν. Χαλκιδικής') {
                    state = 'Μακεδονία';
                    nomos = 'Ν. Χαλκιδικής';
                } else if (areaFull[0].trim() === 'Ν. Λέσβου') {
                    state = 'Νήσοι Αιγαίου Πελάγους';
                    nomos = 'Ν. Λέσβου';
                } else if (areaFull[0].trim() === 'Ν. Χίου') {
                    state = 'Νήσοι Αιγαίου Πελάγους';
                    nomos = 'Ν. Χίου';
                } else {
                    state = areaFull[0];
                    nomos = areaFull[1];
                }
                
                // Municipality specific rules
                let municipality = '';
                if (areaFull.length > 3) {
                    municipality = areaFull[2];
                } else if(areaFull.length > 2) {
                    municipality = areaFull[2];
                } else if(areaFull.length > 1) {
                    municipality = areaFull[1];
                } else {
                    nomos = nomos || areaFull[0];
                }

                const xeDate = $(this).data('edata');

                 
                let ad = {
                    id: $(this).data('id'),
                    area_full: $(this).data('area'),
                    state: state.trim(),
                    nomos: nomos.trim(),
                    tomeas: tomeas.trim(),
                    municipality: municipality.trim(),
                    area: area.trim(),
                    href: 'https://www.xe.gr' + $(this).find('a').attr('href'),
                    type: hrefData[0],
                    price: +price,
                    tm: +tm,
                    cost_tm: +(price/tm).toFixed(0), 
                    is_professional: isProfesssional ? 'yes' : 'no',
                    professional_link: isProfesssional || '',
                    description: $(this).find('p').text().replace(/(\r\n|\n|\r|\t)/gm, "").trim(),
                    xe_date: xeDate ? new Date(xeDate) : null,
                    updated_at: new Date()
                };

                // console.log(ad)
                data.push(ad);
                counter += 1;
            });
            for (let index = 0; index < data.length; index++) {
                const record = await mongo_db.collection('xe_ads').findOne({id : data[index].id});
                if (record) {
                    await mongo_db.collection('xe_ads').updateOne({id : data[index].id}, { $set:  data[index] });
                } else {
                    data[index].created_at = new Date();
                    await mongo_db.collection('xe_ads').insertOne(data[index]);
                }
            }
        }

        logger.info('Crawled:' + counter);
        console.timeEnd('ProcessTime')
    })
} catch (error) {
    console.log(error)
}