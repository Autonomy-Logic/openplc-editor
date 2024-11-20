import {create} from "xmlbuilder2";

import type {ProjectState} from "../../renderer/store/slices";
import {instanceToXml} from "../PLC/instances-xml";
import {parsePousToXML} from "../PLC/pou-xml";
import {getBaseXmlStructure} from "./base-xml";

const XmlGenerator = (projectToGenerateXML: ProjectState['data']) => {
    let xmlResult = getBaseXmlStructure()

    /**
     * Parse POUs
     */
    const pous = projectToGenerateXML.pous
    xmlResult = parsePousToXML(xmlResult, pous)

    /**
     * Parse instances
     */
    const configuration = projectToGenerateXML.configuration
    xmlResult = instanceToXml(xmlResult, configuration)

    const doc = create(xmlResult)
    doc.dec({version: '1.0', encoding: 'utf-8'})

    return doc.end({prettyPrint: true})
}

export {XmlGenerator}
