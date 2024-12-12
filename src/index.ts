import * as cheerio from 'cheerio';
import axios from "axios"
import { writeFile, appendFile } from 'fs/promises';
import logger from './logger';

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
        logger.error('Error fetching HTML:', error);
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
        logger.error('Error fetching HTML:', error);
        return "";
    }
}

function extractGuestCount(html: string) {
    const $ = cheerio.load(html);
    const guestText = $('.storefrontHeadingFaqsCard__label').text().trim();
    
    const rangeMatch = guestText.match(/(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) {
        return {
            min: parseInt(rangeMatch[1]),
            max: parseInt(rangeMatch[2])
        };
    }
    
    const upToMatch = guestText.match(/Jusqu'à\s*(\d+)/);
    if (upToMatch) {
        return {
            min: 0,
            max: parseInt(upToMatch[1])
        };
    }
    
    return null;
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

async function getSecondLastJsonScriptFromUrl(url: string): Promise<string> {
    const html = await getHtml(url)
    if(!html){
        return null
    }
    const secondLastJsonScript = extractSecondLastJsonScript(html)
    return secondLastJsonScript
}

async function extractCityFromSingleObjectPage(url: string): Promise<string> {
    const unparsedJSON = await getSecondLastJsonScriptFromUrl(url)
    try {
        const json = JSON.parse(unparsedJSON)
        return json[0].address.addressLocality
    }catch(err) {
        logger.error("Cannot parse the JSON for url: ", url)
        return null
    }

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

async function getInterestedInfo(domain: Domain): Promise<DomainInfo> {
    if(!domain.address.addressLocality || domain.address.addressLocality == "0"){
        const city = await extractCityFromSingleObjectPage(domain.url)
        if(city){
            return {
                city: city,
                region: domain.address.addressRegion,
                postalCode: domain.address.postalCode,
                url: domain.url,
                name: domain.name
            };        
        }    
    }
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
        ...count,
        type: url.split("/")[3]
    }
}

async function getCompleteDataFormatedOfPage(url: string): Promise<CompleteDomainInfo[]> {
    const allHtml = await getHtml(url);
    const interestedJSON = extractSecondLastJsonScript(allHtml);
    const parsedDomains = parseDomains(interestedJSON);

    const completeInterestedInfos = await Promise.all(
        parsedDomains.map(async domain => { 
            const interestedInfo = await getInterestedInfo(domain); 
            return getInterestedInfoWithMinMax(interestedInfo);
        })
    );

    return completeInterestedInfos;
}

async function formatedJSONToCSV(infos: CompleteDomainInfo[], outFile: string, mode: "w" | "a") {
    const headers = ['type', 'name', 'city', 'region', 'postalCode', 'url', 'min', 'max'];

    const csvRows = [
        // En-têtes
        (mode === "w") ? headers.join(',') : undefined,
        // Données
        ...infos.map(info => {
            return [
                `"${info.type}"`,
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
        logger.success(`CSV file has been saved to: ${outFile}`);
    } catch (error) {
        logger.error('Error writing CSV file:', error);
        throw error;
    }
}

const url = process.argv[2];
const mode = process.argv[3] as "w" | "a";
const outputFile = process.argv[4];
const maxPage = process.argv[5];

if (!url || !mode || !outputFile) {
    logger.error('Usage: npm run start <url> <mode> <outputFile>');
    logger.error('mode should be either "w" (write) or "a" (append)');
    process.exit(1);
}

if (mode !== 'w' && mode !== 'a') {
    logger.error('Mode must be either "w" (write) or "a" (append)');
    process.exit(1);
}

const main = async () => {
    try {
        logger.info("Lancement du script...")
        
        if (!maxPage) {
            logger.info("Aucun nombre de page détecté")
            logger.info("Récupération des informations de la page...")
            const formatedData = await getCompleteDataFormatedOfPage(url);
            if(formatedData){
                logger.success("Information récupéré avec succès")
                logger.info(`Nombre d'éléments trouvés: ${formatedData.length}`)
            }
            logger.info("Sauvegarde dans le fichier: ", outputFile)
            await formatedJSONToCSV(formatedData, outputFile, mode);
            logger.success("Données sauvegardées avec succès")
            return
        }

        const maxPageInt = Number.parseInt(maxPage)
        logger.info(`Traitement de ${maxPageInt} pages...`)
        
        const param = "&NumPage="
        if (!url.includes(param)) {
            logger.info("Génération des URLs avec paramètre de pagination...")
            const promises = Array.from({ length: maxPageInt }, (_, i) =>
                getCompleteDataFormatedOfPage(`${url}${param}${i + 1}`)
            );

            logger.info("Récupération des données de toutes les pages...")
            const allData = await Promise.all(promises);
            logger.success("Données récupérées avec succès")

            const flattenedData = allData.flat();
            logger.info(`Nombre total d'éléments trouvés: ${flattenedData.length}`)
            
            logger.info("Sauvegarde des données dans le fichier CSV...")
            await formatedJSONToCSV(flattenedData, outputFile, mode);
            logger.success("Données sauvegardées avec succès")

        } else {
            logger.info("Modification des URLs existantes avec nouvelle pagination...")
            const promises = Array.from({ length: maxPageInt }, (_, i) => {
                const newUrl = url.replace(/NumPage=\d+/, `NumPage=${i + 1}`);
                return getCompleteDataFormatedOfPage(newUrl);
            });

            logger.info("Récupération des données de toutes les pages...")
            const allData = await Promise.all(promises);
            logger.success("Données récupérées avec succès")

            const flattenedData = allData.flat();
            logger.info(`Nombre total d'éléments trouvés: ${flattenedData.length}`)
            
            logger.info("Sauvegarde des données dans le fichier CSV...")
            await formatedJSONToCSV(flattenedData, outputFile, mode);
            logger.success("Données sauvegardées avec succès")
        }
        
        logger.success("Script terminé avec succès")
        
    } catch (error) {
        logger.error('Erreur lors de l\'exécution:', error)
        process.exit(1);
    }
};

main()