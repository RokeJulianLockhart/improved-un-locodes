import {readCsv} from "./util/readCsv.js";
import {convertToDecimal, convertToUnlocode, getDistanceFromLatLonInKm} from "./util/coordinatesConverter.js";
import {getNominatimData, readNominatimDataByCity} from "./util/nominatim-loader.js";
import {validateCoordinates} from "./util/entry-validator.js";
import fs from "fs";
import {downloadByCityIfNeeded} from "./util/nominatim-downloader.js";
import {FALSE_POSITIVES} from "./false-positives.js";

async function validateAllCoordinates() {
    const csvDatabase = await readCsv()

    const dataOut = fs.createWriteStream('../../data/code-list-improved.csv')
    writeCsv(dataOut, ["Change", "Country", "Location", "Name","NameWoDiacritics","Subdivision","Status","Function","Date","IATA","Coordinates","Remarks","Source","Distance"])

    for (const unlocode of Object.keys(csvDatabase)) {
        const entry = csvDatabase[unlocode]

        const entries = [entry.change, entry.country, entry.location,entry.city,entry.nameWithoutDiacritics,entry.subdivisionCode,entry.status,entry.function,entry.date,entry.iata,entry.coordinates,entry.remarks]

        const decimalCoordinates = convertToDecimal(entry.coordinates)
        if (!decimalCoordinates) {
            // TODO: fall back to Nominatim
            entries.push("N/A", "N/A")
            writeCsv(dataOut, entries)
            continue
        }

        const nominatimData = await getNominatimData(entry)
        if (!nominatimData) {
            // Nominatim can't find it, which most likely means a non-standard name is found.
            // For example ITMND which has the name "Mondello, Palermo" or ITAQW with the name "Acconia Di Curinga"
            // These should be called "Mondello" and "Acconia" to be found in nominatim.

            // Let's choose UN/LOCODE because these examples are actually fine
            entries.push("N/A (no Nominatim)", "UN/LOCODE")
            writeCsv(dataOut, entries)
            continue
        }

        const nominatimResult = nominatimData.result
        const firstNominatimResult = nominatimResult[0]
        const distance = Math.round(getDistanceFromLatLonInKm(decimalCoordinates.latitude, decimalCoordinates.longitude, firstNominatimResult.lat, firstNominatimResult.lon));
        if (distance < 100 || FALSE_POSITIVES.includes(unlocode)) {
            entries.push("UN/LOCODE", distance)
            writeCsv(dataOut, entries)
            continue
        }

        const closeResults = nominatimResult.filter(n => {
            return getDistanceFromLatLonInKm(decimalCoordinates.latitude, decimalCoordinates.longitude, n.lat, n.lon) < 100
        })
        if (closeResults.length !== 0) {
            // The first hit isn't close, but there is another one who is. Keep UN/LOCODE
            const distanceCloseResult = Math.round(getDistanceFromLatLonInKm(decimalCoordinates.latitude, decimalCoordinates.longitude, closeResults[0].lat, closeResults[0].lon));
            entries.push("UN/LOCODE", distanceCloseResult)
            writeCsv(dataOut, entries)
            continue
        }

        const scrapeType = nominatimData.scrapeType
        if (scrapeType === "byRegion") {
            // We couldn't find any matching result by region. Let's scrape by city as well to see if there is a location in another region where the coordinates do match (like ITAN2)
            // This means that either the coordinates are wrong, or the region is wrong.
            // Example: ITAN2: The coordinates point to Antignano,Livorno, but there actually is a village Antignano, Asti.
            // Still, in most cases it's just that the wrong region is set in UN/LOCODE: choose that

            await downloadByCityIfNeeded(entry)
            const nominatimDataByCity = readNominatimDataByCity(unlocode)?.result
            const closeResults = nominatimDataByCity?.filter(n => {
                return getDistanceFromLatLonInKm(decimalCoordinates.latitude, decimalCoordinates.longitude, n.lat, n.lon) < 100
            })
            if (closeResults !== undefined && closeResults.length !== 0) {
                entries.push("UN/LOCODE",getDistanceFromLatLonInKm(decimalCoordinates.latitude, decimalCoordinates.longitude, closeResults[0].lat, closeResults[0 ].lon))
                continue
            }
        }
        // If we're still here and still don't have a close result, choose Nominatim
        const nominatimEntries =[entry.change,entry.country,entry.location,entry.city,entry.nameWithoutDiacritics,entry.subdivisionCode,entry.status,entry.function,entry.date,entry.iata,convertToUnlocode(firstNominatimResult.lat, firstNominatimResult.lon),entry.remarks,distance,firstNominatimResult.sourceUrl]
        writeCsv(dataOut, nominatimEntries)
    }
}

function writeCsv(dataOut, entries) {
    const withQuotesIfNeeded = entries.map(entry => {
        if (typeof entry === "string" && entry.includes(",")) {
            return `\"${entry}\"`
        } else {
            return entry
        }
    })
    dataOut.write(withQuotesIfNeeded.join(",")+ "\n")
}

validateAllCoordinates()