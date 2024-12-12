import * as cheerio from 'cheerio';
import axios from "axios"
import { writeFile, appendFile } from 'fs/promises';
import logger from './logger';

async function getHtml(url: string): Promise<string> {
    logger.info(`Récupération du HTML pour l'URL: ${url}`)
    try {
        const response = await axios.get(url);
        if (response.data) {
            logger.success(`HTML récupéré avec succès pour: ${url}`)
            const $ = cheerio.load(response.data);
            const htmlContent = $('html').html() || "";
            return htmlContent;
        }
        logger.warn(`Aucun contenu HTML trouvé pour: ${url}`)
        return "";
    } catch (error) {
        logger.error(`Erreur lors de la récupération du HTML pour ${url}:`, error);
        return "";
    }
}

async function getGuestCountHtml(url: string): Promise<string> {
    logger.info(`Récupération des informations invités pour: ${url}`)
    try {
        const response = await axios.get(url);
        if (response.data) {
            const $ = cheerio.load(response.data);
            const divContent = $('[data-testid="storefrontHeadingFaqsCardGuests"]').html() || "";
            if (divContent) {
                logger.success(`Informations invités trouvées pour: ${url}`)
            } else {
                logger.warn(`Aucune information invités trouvée pour: ${url}`)
            }
            return divContent;
        }
        logger.warn(`Aucun contenu trouvé pour: ${url}`)
        return "";
    } catch (error) {
        logger.error(`Erreur lors de la récupération des informations invités pour ${url}:`, error);
        return "";
    }
}

function extractGuestCount(html: string) {
    const $ = cheerio.load(html);
    const guestText = $('.storefrontHeadingFaqsCard__label').text().trim();
    
    const rangeMatch = guestText.match(/(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) {
        logger.info(`Plage d'invités trouvée: ${rangeMatch[1]} - ${rangeMatch[2]}`)
        return {
            min: parseInt(rangeMatch[1]),
            max: parseInt(rangeMatch[2])
        };
    }
    
    const upToMatch = guestText.match(/Jusqu'à\s*(\d+)/);
    if (upToMatch) {
        logger.info(`Nombre maximum d'invités trouvé: ${upToMatch[1]}`)
        return {
            min: 0,
            max: parseInt(upToMatch[1])
        };
    }
    
    logger.warn("Aucune information sur le nombre d'invités trouvée")
    return null;
}

async function getGuestCount(url: string): Promise<{ min: number, max: number }> {
    logger.info(`Récupération du nombre d'invités pour: ${url}`)
    const html = await getGuestCountHtml(url)
    const guestCount = extractGuestCount(html)
    if (guestCount) {
        logger.success(`Nombre d'invités récupéré avec succès pour: ${url}`)
        return guestCount
    }
    logger.warn(`Impossible de récupérer le nombre d'invités pour: ${url}`)
}


function extractSecondLastJsonScript(html: string): string {
    logger.info("Extraction du script JSON")
    const $ = cheerio.load(html);
    const jsonScripts = $('script');
    if (jsonScripts.length >= 2) {
        logger.success("Script JSON extrait avec succès")
        return $(jsonScripts[jsonScripts.length - 2]).html() || '';
    }
    logger.warn("Aucun script JSON trouvé")
    return '';
}

async function getSecondLastJsonScriptFromUrl(url: string): Promise<string> {
    logger.info(`Récupération du script JSON pour: ${url}`)
    const html = await getHtml(url)
    if(!html){
        logger.warn(`Aucun HTML trouvé pour: ${url}`)
        return null
    }
    const secondLastJsonScript = extractSecondLastJsonScript(html)
    return secondLastJsonScript
}

async function extractCityFromSingleObjectPage(url: string): Promise<string> {
    logger.info(`Extraction de la ville pour: ${url}`)
    const unparsedJSON = await getSecondLastJsonScriptFromUrl(url)
    try {
        const json = JSON.parse(unparsedJSON)
        const city = json[0].address.addressLocality
        if (city) {
            logger.success(`Ville trouvée: ${city}`)
        } else {
            logger.warn("Aucune ville trouvée")
        }
        return city
    } catch(err) {
        logger.error(`Erreur lors du parsing JSON pour ${url}:`, err)
        return null
    }
}

function parseDomains(jsonString: string): Domain[] {
    logger.info("Parsing des domaines")
    try {
        const domains: Domain[] = JSON.parse(jsonString);
        logger.success(`${domains.length} domaines parsés avec succès`)
        return domains.map(domain => ({
            ...domain
        }));
    } catch (error) {
        logger.error("Erreur lors du parsing des domaines:", error)
        return [];
    }
}
async function getInterestedInfo(domain: Domain): Promise<DomainInfo> {
    logger.info(`Récupération des informations pour: ${domain.name}`)
    if(!domain.address.addressLocality || domain.address.addressLocality == "0"){
        logger.info(`Ville manquante pour ${domain.name}, tentative de récupération...`)
        const city = await extractCityFromSingleObjectPage(domain.url)
        if(city){
            logger.success(`Ville récupérée avec succès pour: ${domain.name}`)
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
    logger.info(`Ajout des informations min/max pour: ${domainInfo.name}`)
    const url = domainInfo.url
    const count = await getGuestCount(url)
    if (count) {
        logger.success(`Informations min/max ajoutées pour: ${domainInfo.name}`)
    } else {
        logger.warn(`Impossible d'ajouter les informations min/max pour: ${domainInfo.name}`)
    }
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
    logger.info(`Conversion en CSV pour ${infos.length} éléments`)
    const headers = ['type', 'name', 'city', 'region', 'postalCode', 'url', 'min', 'max'];

    const csvRows = [
        (mode === "w") ? headers.join(',') : undefined,
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
            logger.info(`Ajout au fichier existant: ${outFile}`)
            await appendFile(`./data/${outFile}`, csvContent, 'utf-8')
        }
        if (mode == "w") {
            logger.info(`Création du fichier: ${outFile}`)
            await writeFile(`./data/${outFile}`, csvContent, 'utf-8');
        }
        logger.success(`Fichier CSV sauvegardé: ${outFile}`);
    } catch (error) {
        logger.error('Erreur lors de l\'écriture du fichier CSV:', error);
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