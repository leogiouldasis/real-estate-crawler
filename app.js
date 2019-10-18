require('dotenv').config()
// puppeteer-extra is a drop-in replacement for puppeteer,
// it augments the installed puppeteer with plugin functionality.
// Any number of plugins can be added through `puppeteer.use()`
const puppeteer = require("puppeteer-extra");
const moment = require("moment");
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

const monthMapping = {
    'Ιανουαρίου': '01',
    'Φεβρουαρίου': '02',
    'Μαρτίου': '03',
    'Απριλίου': '04',
    'Μαΐου': '05',
    'Ιουνίου': '06',
    'Ιουλίου' : '07',
    'Αυγούστου': '08',
    'Σεπτεμβρίου': '09',
    'Οκτωβρίου': '10',
    'Νοεμβρίου': '11',
    'Δεκεμβρίου': '12'
};

const monthShortMapping = {
    'Ιαν': '01',
    'Φεβ': '02',
    'Μαρ': '03',
    'Απρ': '04',
    'Μαΐ': '05',
    'Ιουν': '06',
    'Ιουλ' : '07',
    'Αυγ': '08',
    'Σεπ': '09',
    'Οκτ': '10',
    'Νοε': '11',
    'Δεκ': '12'
};

// Add plugin to anonymize the User-Agent and signal Windows as platform
const UserAgentPlugin = require("puppeteer-extra-plugin-anonymize-ua")
puppeteer.use(UserAgentPlugin({ makeWindows: true }))
try {
    console.time('ProcessTime')
    // That's it, the rest is puppeteer usage as normal 😊
    puppeteer.launch({ headless: true, args: ['--no-sandbox'] }).then(async browser => {
        let counter = 0;
        let inserted = 0;
        let updated = 0;
        let failedPages = 0;
        let failedAds = 0;
        const offset = process.env.WORKER_OFFSET;
        const limit = process.env.WORKER_LIMIT;
        const start = 1 + +offset;
        const finish = +start + +limit;
        const resultsPerPage = process.env.RESULTS_PER_PAGE;

        logger.info('Crawling from:' + start + ' to:' + finish)

        for (let index = start; index < finish; index++) {
            let page;
            try {
                page = await browser.newPage()
                await page.setViewport({ width: 800, height: 600 })
                // To ensure XE doesn't detect it as a Bot
                if(process.env.EXTRA_HEADERS) {
                    await page.setExtraHTTPHeaders({
                        'Accept-Language': process.env.ACCEPT_LANGUAGE
                    });
                }
                
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
                let url = 'https://www.xe.gr/property/search?Transaction.type_channel=117518&page=' + index + '&per_page=' + resultsPerPage + '&sort_by=Publication.effective_date_start&sort_direction=desc';
                // url = 'https://www.xe.gr/property/search?System.item_type=re_residence&Transaction.type_channel=117518&Geo.area_id_new__hierarchy=82455&Transaction.price.from=300000&Transaction.price.to=300000&Item.area.from=270&Item.area.to=270';
                logger.info('Crawling:' + url);
                await page.goto(url, {timeout: 60000})
                logger.info('Waiting for Listing Load');
                try {
                    await page.waitForSelector('.pager', {timeout: 60000});
                    // await page.waitForSelector('.saveSearch_btn', {timeout: 60000});
                } catch (error) {
                    failedPages += 1;
                    logger.info('No selector found')
                }
                
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
                    const isPrivate = $(this).find('.r_private').attr('title') || false;
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
                    } else if (areaFull.length > 2) {
                        municipality = areaFull[2];
                    } else if (areaFull.length > 1) {
                        municipality = areaFull[1];
                    } else {
                        nomos = nomos || areaFull[0];
                    }

                    const d = new Date();
                    const hour = d.getHours();
                    const minutes = d.getMinutes();
                    let xeDate = $(this).find('.r_date').text().trim().split(' ');
                    xeDate = new Date(xeDate[3] +'-'+ monthShortMapping[xeDate[2]] +'-'+ xeDate[1] +' '+ hour + ':' + minutes );

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
                        cost_tm: +(price / tm).toFixed(0),
                        is_professional: isPrivate ? 'no' : 'yes',
                        professional_link: isProfesssional || '',
                        description: $(this).find('p').text().replace(/(\r\n|\n|\r|\t)/gm, "").trim(),
                        xe_date: xeDate,
                        updated_at: new Date()
                    };

                    console.log(ad)
                    data.push(ad);
                    counter += 1;
                });
                for (let index = 0; index < data.length; index++) {
                    const record = await mongo_db.collection('xe_ads').findOne({ id: data[index].id });
                    if (record) {
                        logger.info('Updating AD:' + (data[index].id));
                        data[index].crawled_at = moment().toDate() 
                        await mongo_db.collection('xe_ads').updateOne({ id: data[index].id }, { $set: data[index] });
                        updated += 1; 
                    } else {
                        page = await browser.newPage()
                        await page.setViewport({ width: 800, height: 600 })
                        // To ensure XE doesn't detect it as a Bot
                        if(process.env.EXTRA_HEADERS) {
                            await page.setExtraHTTPHeaders({
                                'Accept-Language': process.env.ACCEPT_LANGUAGE
                            });
                        }
                        
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
                        logger.info('Crawling:' + encodeURI(data[index].href));
                        await page.goto(encodeURI(data[index].href), {timeout: 60000})
                        logger.info('Waiting for Ad:' + data[index].id);
                        try {
                            await page.waitForSelector('.phone-area', {timeout: 60000});
                        } catch (error) {
                            failedAds += 1;
                            logger.info('No selector (phone-area) found')
                        }
                        
                        let content = await page.content();
                        let $ = cheerio.load(content);
                        await page.close();

                        if ($("title").text() === 'Pardon Our Interruption') {
                            logger.error('Blocked');
                        } else {
                            logger.info('Found Content on AD');
                        }
                        
                        // Additional info from ad page
                        let phone = $(".phone-area").find('a').attr('href');
                        data[index].phone = phone ? phone.replace(/\D/g,'') : null;      
                        data[index].description_content = $(".description-content").text().trim();
                        let xeCreatedDate = $(".stats-content").find('div :nth-child(1)').text().replace('Δημιουργία αγγελίας:', '').trim().split(' ');
                        data[index].xe_created_at = moment(xeCreatedDate[3] +'-'+ monthMapping[xeCreatedDate[2]] +'-'+ xeCreatedDate[1]).toDate();
                        data[index].crawled_at = new Date()
                        data[index].created_at = new Date()
                        await mongo_db.collection('xe_ads').insertOne(data[index]);
                        inserted += 1;
                    }
                }
            } catch (error) {
                console.log(error)
                await page.close();
            }
        }

        logger.info('Crawled:' + counter);
        logger.info('Inserted:' + inserted);
        logger.info('Updated:' + updated);
        logger.info('Failed Pages:' + failedPages);
        logger.info('Failed Ads:' + failedAds);
        
        console.timeEnd('ProcessTime');
    })
} catch (error) {
    console.log(error)
}