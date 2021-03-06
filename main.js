const Apify = require('apify');

/**
 * Gets attribute as text from a ElementHandle.
 * @param {ElementHandle} element - The element to get attribute from.
 * @param {string} attr - Name of the attribute to get.
 */
async function getAttribute(element, attr){
    try{
        const prop = await element.getProperty(attr);
        return (await prop.jsonValue()).trim();
    }
    catch(e){return null;}
}

/** Finds a working proxy*/
async function getValidSessionID(url, proxyGroup){
    const id = Math.random() + '';
    for(let i = 0; i < 10; i++){
        console.log('testing proxy...');
        const session = `${id}_${i}`;
        let browser;
        try{
            browser = await Apify.launchPuppeteer({
                useApifyProxy: true,
                apifyProxySession: session,
                apifyProxyGroups: [proxyGroup]
            });
            const page = await browser.newPage();
            await page.goto(url);
            await page.close();
            await new Promise(resolve => setTimeout(resolve, 10));
            await browser.close();
        }
        catch(e){
            console.log('invalid proxy, retrying...');
            try{await browser.close();}catch(a){}
        }
        console.log('valid proxy found');
        return session;
    }
}

async function findEmailsFromWebsites(results){
    const qMap = {};
    const customData = {
        queries: [], 
        skipRegex: [
            'facebook',
            'linkedin',
            'google',
            'yelp',
            'remax',
            'narpm',
            'buzzfile',
            'zoominfo',
            'alignable'
        ]
    };
    for(const result of results){
        const query = result.name + ' ' + result.company;
        customData.queries.push(query);
        qMap[query] = result;
    }
    
    console.log('running website search');
    const run = await Apify.call('petr_cermak/google-batch', customData);
    console.log('website search finished');
    
    const dataset = await Apify.openDataset(run.defaultDatasetId);
    await dataset.forEach(async gResult => {
        try{
            const oResult = qMap[gResult.query];
            if(gResult.link){
                const uriMatch = gResult.link.match(/q=([^&]+)/);
                const searchUrl = gResult.displayed_link.indexOf('...') > -1 ? ((uriMatch && uriMatch.length > 1) ? decodeURIComponent(uriMatch[1]) : gResult.displayed_link) : gResult.displayed_link;
                if(searchUrl && searchUrl.length > 0){
                    const session = await getValidSessionID(searchUrl, 'BUYPROXIES94952');
                    const emails = await getAllEmails(searchUrl);
                    oResult.emails = emails;
                }
            }
        }
        catch(e){console.log(e);}
    });
}

async function getAllEmails(url, proxyGroup, session){
    if(url.indexOf('linkedin') > -1){return [];}
    console.log('searching e-mails for: ' + url);
    const emails = {};
    const proxyConfig = {useApifyProxy: true};
    if(proxyGroup){proxyConfig.apifyProxyGroups = [proxyGroup];}
    if(session){proxyConfig.apifyProxySession = session;}
    const socRun = await Apify.call('petr_cermak/social-extractor', {
      "startUrls": [{url}],
      "skipDomains": [],
      "proxyConfig": proxyConfig,
      "maxDepth": (url.indexOf('facebook') > -1 || url.indexOf('google') > -1) ? 1 : 2,
      "maxRequests": 50,
      "waitForAjax": true,
      "sameDomain": true,
      "liveView": false
    });
    const dataset = await Apify.openDataset(socRun.defaultDatasetId);
    await dataset.forEach(async sResult => {
        try{
            if(sResult.emails && sResult.emails.length > 0){
                for(const email of sResult.emails){
                    emails[email] = true;
                }
            }
        }
        catch(e){console.log(e);}
    });
    const eKeys = Object.keys(emails)
    console.log('e-mails found: ' + eKeys.length);
    return eKeys;
}

const getText = async element => await getAttribute(element, 'textContent');

Apify.main(async () => {
    let results = [];
    let promises = [];
    const process = async (items) => {
        if(items.length >= 10){
            promises.push((async () => {
                await findEmailsFromWebsites(items);
                await Apify.pushData(items);
            })());
            return true;
        }
        return false;
    };
    try{
        const dataset = await Apify.openDataset('WBQXKxrvKu82LcrBC');
        await dataset.forEach(async item => {
            if(!item.emails || item.emails.length < 1){
                results.push(item);
                if(await process(results)){results = [];}
                if(promises.length > 12){
                    await Promise.all(promises);
                    promises = [];
                }
            }
        });
        await process();
        if(promises.length > 7){await Promise.all(promises);}
    }
    catch(e){console.log(e);}
});

/*Apify.main(async () => {
    
    const rpp = 10; //100
    const totalPages = 590; //59
    
    const startUrl = 'https://www.narpm.org/find/property-managers?submitted=true&toresults=1&resultsperpage=' + rpp + '&a=managers&orderby=&fname=&lname=&company=&chapter=&city=&state=&xRadius=';
    const requestQueue = await Apify.openRequestQueue();

    for(let i = 0; i < totalPages; i++){
        await requestQueue.addRequest(new Apify.Request({
            url: startUrl + '&page=' + i,
            userData: {
                label: 'page', page: i
            }
        }));
    }

    // This page is executed for each request.
    // If request failes then it's retried 3 times.
    // Parameter page is Puppeteers page object with loaded page.
    const handlePageFunction = async ({ page, request }) => {
        const results = [];

        console.log('processing page: ' + request.userData.page)

        const members = await page.$$('.member-item-wrapper');
        for(const member of members){
            const cols = await member.$$('.member-list-head > div');
            const addr = await member.$('[itemprop="streetAddress"]');
            const phone = await member.$('[itemprop="telephone"]');
            const pText = (await getText(phone)).split(':');

            const result = {
                name: (await getText(cols[0])).split('MPM®')[0].replace(/\s+/g, ' '),
                company: (await getText(cols[1])).replace(/\s+/g, ' '),
                city: await getText(cols[2]),
                state: await getText(cols[3]),
                address: await getText(addr),
                phone: pText[pText.length - 1].trim()
            };

            results.push(result);
        }

        // Find all emails.
        await findEmailsFromWebsites(results);
        
        // Save data.
        await Apify.pushData(results);
    };

    // If request failed 4 times then this function is executed.
    const handleFailedRequestFunction = async ({ request }) => {
        console.log(`Request ${request.url} failed 4 times`);
    };

    const gotoFunction = async ({ page, request }) => {
        return await page.goto(request.url, {timeout: 200000});
    };

    // Create crawler.
    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        handlePageFunction,
        handleFailedRequestFunction,
        handlePageTimeoutSecs: 99999
    });

    // Run crawler.
    await crawler.run();
});*/
