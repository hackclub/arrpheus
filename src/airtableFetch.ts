export class AirtableFetch {
    // same api as Airtable-Plus but uses raw fetch() with no retry logic
    urlBase = 'https://middleman.hackclub.com/airtable/v0/'
    apiKey: string;
    baseID: string;
    tableName: string;
    url: string;
    constructor({ apiKey, baseID, tableName }) {
        this.apiKey = apiKey;
        this.baseID = baseID;
        this.tableName = tableName;
        this.url = this.urlBase + baseID + '/' + tableName;
    }

    async read(args: {filterByFormula?, maxRecords?} | undefined=undefined) {
        let paramsObj = {}
        if (args && args.filterByFormula) {
            //console.log(`encoding formula: ${args.filterByFormula}`)
            const newFormula = args.filterByFormula.replaceAll(",", "%2C").replaceAll("=", "%3D").replaceAll("{", "%7B").replaceAll("}", "%7D").replaceAll("+", "%2B").replaceAll("/", "%2F").replaceAll(" ", "+") // ' and , aren't encoded and <space>->+ for some reason
            //console.log(`encoded formula: ${newFormula}`)
            paramsObj['filterByFormula'] = newFormula
        }
        if (args && args.maxRecords) {
            paramsObj['maxRecords'] = args.maxRecords
        }

        let params = "";
        for (const key in paramsObj) {
            params += `${key}=${paramsObj[key]}&`
        }

        console.log("Fetching from Airtable:")
        console.log(this.url + '?' + params)
        const res = await fetch(this.url + '?' + params, {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'User-Agent': 'Arrpheus/1.0.0'
            }
        })
        //console.log("Got response:")
        //console.log(res)
        if (!res.ok) {
            const body = await res.text()
            throw new Error(`Failed to fetch from Airtable: ${res.status} ${res.statusText} ${body}`)
        }
        const json = await res.json()
        console.log("Response JSON:")
        console.log(json)
        return json.records
    }

    async update(recordId, fields) {
        const res = await fetch(this.url + '/' + recordId, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Arrpheus/1.0.0'
            },
            body: JSON.stringify({fields})
        })
        const json = await res.json()
        return json
    }

    async updateBulk(records) {
        const res = await fetch(this.url, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Arrpheus/1.0.0'
            },
            body: JSON.stringify({records})
        })
        const json = await res.json()
        return json
    }
}