/* eslint-disable simple-import-sort/imports */
import ActionsRoot from './actions-root';
import DropDown from './dropdown/actions-dropdown';
import Input from './search/actions-input';
import Label from './search/actions-label';
import Options from './dropdown/actions-options';
import Search from './search/actions-search';
import Select from './dropdown/actions-select'

const ActionsBar = {
  Options,
  ActionsRoot,
  Select,
  DropDown,
  Input,
  Label,
  Search
};

export default ActionsBar;
