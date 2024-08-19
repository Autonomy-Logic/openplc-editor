export interface Welcome8 {
    project: Project;
}

export interface Project {
    fileHeader:     FileHeader;
    contentHeader:  ContentHeader;
    types:          Types;
    instances:      Instances;
    "_xmlns:ns1":   string;
    "_xmlns:xhtml": string;
    "_xmlns:xsd":   string;
    _xmlns:         string;
}

export interface ContentHeader {
    coordinateInfo:        CoordinateInfo;
    _name:                 string;
    _author:               string;
    _modificationDateTime: Date;
}

export interface CoordinateInfo {
    fbd: Fbd;
    ld:  Fbd;
    sfc: Fbd;
}

export interface Fbd {
    scaling: Scaling;
}

export interface Scaling {
    _x: string;
    _y: string;
}

export interface FileHeader {
    _companyName:      string;
    _productName:      string;
    _productVersion:   string;
    _creationDateTime: Date;
}

export interface Instances {
    configurations: string;
}

export interface Types {
    dataTypes: string;
    pous:      Pous;
}

export interface Pous {
    pou: Pou[];
}

export interface Pou {
    interface:     Interface;
    body:          Body;
    documentation: Documentation;
    _name:         string;
    _pouType:      PouType;
}

export enum PouType {
    FunctionBlock = "functionBlock",
}

export interface Body {
    ST: Documentation;
}

export interface Documentation {
    p: P;
}

export interface P {
    __prefix: Prefix;
    __cdata:  string;
}

export enum Prefix {
    XHTML = "xhtml",
}

export interface Interface {
    inputVars:  InputVars;
    outputVars: OutputVars;
    localVars?: LocalVars;
}

export interface InputVars {
    variable: PurpleVariable[] | FluffyVariable;
}

export interface PurpleVariable {
    type:           PurpleType;
    _name:          string;
    documentation?: Documentation;
}

export interface PurpleType {
    BOOL?:    string;
    INT?:     string;
    DINT?:    string;
    LINT?:    string;
    UDINT?:   string;
    ULINT?:   string;
    TIME?:    string;
    derived?: Derived;
}

export interface Derived {
    _name: DerivedName;
}

export enum DerivedName {
    RTrig = "R_TRIG",
}

export interface FluffyVariable {
    type:  FluffyType;
    _name: string;
}

export interface FluffyType {
    BOOL: string;
}

export interface LocalVars {
    variable: TentacledVariable[] | StickyVariable;
    _retain?: string;
}

export interface TentacledVariable {
    type:           TentacledType;
    initialValue?:  InitialValue;
    documentation?: Documentation;
    _name:          string;
}

export interface InitialValue {
    simpleValue: SimpleValue;
}

export interface SimpleValue {
    _value: string;
}

export interface TentacledType {
    SINT?: string;
    BOOL?: string;
    TIME?: string;
}

export interface StickyVariable {
    type:  StickyType;
    _name: string;
}

export interface StickyType {
    BOOL?:    string;
    derived?: Derived;
}

export interface OutputVars {
    variable: IndigoVariable[] | FluffyVariable;
}

export interface IndigoVariable {
    type:           PurpleType;
    _name:          VariableName;
    initialValue?:  InitialValue;
    documentation?: Documentation;
}

export enum VariableName {
    CDT = "CD_T",
    CuT = "CU_T",
    Cv = "CV",
    Et = "ET",
    Q = "Q",
    Qd = "QD",
    Qu = "QU",
}
