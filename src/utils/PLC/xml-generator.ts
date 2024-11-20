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
    // console.log('=-=-=-= FINISHED PARSE TO XML =-=-=-=')
    // console.log('=-=-=-= SAVING XML =-=-=-=')
    // window.bridge
    //   .writeXMLFile(project.meta.path.replace('project.json', ''), xml, 'plc')
    //   .then((res) => {
    //     if (res) {
    //       console.log('File saved', project.meta.path.replace('project.json', 'plc.xml'))
    //       console.log('=-=-=-= FINISHED SAVING XML =-=-=-=')
    //     }
    //   })
    //   .catch((err) => {
    //     console.error('Error saving project:', err)
    //     console.log('=-=-=-= FINISHED SAVING XML =-=-=-=')
    //   })

}

export {XmlGenerator}
