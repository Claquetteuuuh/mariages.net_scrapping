import * as cheerio from 'cheerio';
import axios from "axios"
import * as fs from 'fs';
import { writeFile, appendFile } from 'fs/promises';

async function getHtml(url: string): Promise<string> {
    try {
        const response = await axios.get(url);
        if (response.data) {
            const $ = cheerio.load(response.data);
            const htmlContent = $('html').html() || "";
            return htmlContent;
        }
        return "";
    } catch (error) {
        console.error('Error fetching HTML:', error);
        return "";
    }
}

async function getGuestCountHtml(url: string): Promise<string> {
    try {
        const response = await axios.get(url);
        if (response.data) {
            const $ = cheerio.load(response.data);
            const divContent = $('[data-testid="storefrontHeadingFaqsCardGuests"]').html() || "";
            return divContent;
        }
        return "";
    } catch (error) {
        console.error('Error fetching HTML:', error);
        return "";
    }
}

function extractGuestCount(html: string) {
    const $ = cheerio.load(html);
    const guestText = $('.storefrontHeadingFaqsCard__label').text().trim();

    const match = guestText.match(/(\d+)\s*-\s*(\d+)/);
    if (!match) return null;

    return {
        min: parseInt(match[1]),
        max: parseInt(match[2])
    };
}

async function getGuestCount(url: string): Promise<{ min: number, max: number }> {
    const html = await getGuestCountHtml(url)
    const guestCount = extractGuestCount(html)
    if (guestCount) {
        return guestCount
    }
}

function extractSecondLastJsonScript(html: string): string {
    const $ = cheerio.load(html);
    const jsonScripts = $('script');
    if (jsonScripts.length >= 2) {
        return $(jsonScripts[jsonScripts.length - 2]).html() || '';
    }
    return '';
}

function parseDomains(jsonString: string): Domain[] {
    const domains: Domain[] = JSON.parse(jsonString);

    return domains.map(domain => ({
        ...domain,
        /* aggregateRating: {
            ...domain.aggregateRating,
            reviewCount: Number(domain.aggregateRating.reviewCount),
            ratingValue: String(domain.aggregateRating.ratingValue)
        }
        */
    }));
}

function getInterestedInfo(domain: Domain): DomainInfo {
    return {
        city: domain.address.addressLocality,
        region: domain.address.addressRegion,
        postalCode: domain.address.postalCode,
        url: domain.url,
        name: domain.name
    };
}

async function getInterestedInfoWithMinMax(domainInfo: DomainInfo) {
    const url = domainInfo.url
    const count = await getGuestCount(url)
    return {
        ...domainInfo,
        ...count
    }
}

async function getCompleteDataFormatedOfPage(url: string): Promise<CompleteDomainInfo[]> {
    const allHtml = await getHtml(url);
    const interestedJSON = extractSecondLastJsonScript(allHtml);
    const parsedDomains = parseDomains(interestedJSON);

    const completeInterestedInfos = await Promise.all(
        parsedDomains.map(domain => {
            const interestedInfo = getInterestedInfo(domain);
            return getInterestedInfoWithMinMax(interestedInfo);
        })
    );

    return completeInterestedInfos;
}

async function formatedJSONToCSV(infos: CompleteDomainInfo[], outFile: string, mode: "w" | "a") {
    const headers = ['name', 'city', 'region', 'postalCode', 'url', 'min', 'max'];

    const csvRows = [
        // En-têtes
        (mode === "w") ? headers.join(',') : undefined,
        // Données
        ...infos.map(info => {
            return [
                `"${info.name.replace(/"/g, '""')}"`,
                `"${info.city}"`,
                `"${info.region}"`,
                `"${info.postalCode}"`,
                `"${info.url}"`,
                info.min,
                info.max
            ].join(',');
        })
    ];

    const csvContent = csvRows.join('\n');

    try {
        if (mode === "a") {
            await appendFile(`./data/${outFile}`, csvContent, 'utf-8')
        }
        if (mode == "w") {
            await writeFile(`./data/${outFile}`, csvContent, 'utf-8');
        }
        console.log(`CSV file has been saved to: ${outFile}`);
    } catch (error) {
        console.error('Error writing CSV file:', error);
        throw error;
    }
}

const url = process.argv[2];
const mode = process.argv[3] as "w" | "a";
const outputFile = process.argv[4];

if (!url || !mode || !outputFile) {
    console.error('Usage: npm run start <url> <mode> <outputFile>');
    console.error('mode should be either "w" (write) or "a" (append)');
    process.exit(1);
}

if (mode !== 'w' && mode !== 'a') {
    console.error('Mode must be either "w" (write) or "a" (append)');
    process.exit(1);
}

const main = async () => {
    try {
        const formatedData = await getCompleteDataFormatedOfPage(url);
        await formatedJSONToCSV(formatedData, outputFile, mode);
    } catch (error) {
        console.error('Error in main execution:', error);
        process.exit(1);
    }
};

main()