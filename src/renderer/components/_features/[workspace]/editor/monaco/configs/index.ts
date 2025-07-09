import './languages/il/il.register'
import './languages/st/st.register'
import './themes/openplc/openplc.register'

import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

loader.config({ monaco })
void loader.init()
