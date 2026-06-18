export const state = {
  mappingGroups: [],
  get automationMappings() {
    return this.mappingGroups.flatMap(group => 
      group.commands.map(cmd => ({
        prefix: group.prefix,
        title: group.title,
        ...cmd
      }))
    );
  },
  draggedMappingRow: null,
  globalParsedItems: [],
  vmixActionQueue: Promise.resolve(),
  globalSlotMap: {},
  activeRundownId: null,
  
  timerPollTimeout: null,
  currentAutomationColumnName: 'Switcher',
  activeOnAirRowId: null,
  activeOnAirStartDate: null,
  activeOnAirCmdIndex: -1,
  flushAutomation: false,
  activeAutomationAbortController: null,
  activeAutomationPromise: null,
  
  previewTimeout: null,
  lastPreviewCursorRow: -1,
  lastPreviewCursorCmd: -1,
  
  activeRundownStartTime: null,
  activeRundownEndTime: null,
  serverTimeOffsetMs: 0,
  timerIgnoreApiUpdatesUntil: 0,
  
  blockEarliestRowData: {},
  autoRefreshInterval: null,
  lastRundownSignature: null,
  recentRundownSignatures: new Set(),
  lastLocalUpdate: 0,
  
  activeScriptItem: null,
  
  imageExts: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp', 'heif'],
  audioExts: ['mp3', 'wav'],
  titleExts: ['gt', 'xaml']
};

// DOM Elements
export const dom = {
  rundownList: document.getElementById('rundown-list'),
  btnRefreshRundown: document.getElementById('btn-refresh-rundown'),
  btnResetRundown: document.getElementById('btn-reset-rundown'),
  activeRundownTitle: document.getElementById('active-rundown-title'),
  modalRundowns: document.getElementById('modal-rundowns'),
  rundownListModal: document.getElementById('rundown-list-modal'),
  btnOpenRundowns: document.getElementById('btn-open-rundowns'),
  btnCloseRundowns: document.getElementById('btn-close-rundowns'),
  btnLoadRundown: document.getElementById('btn-load-rundown'),
  selectRundown: document.getElementById('select-rundown'),
  
  modalSettings: document.getElementById('settings-modal'),
  btnOpenSettings: document.getElementById('btn-settings'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  btnCancelSettings: document.getElementById('btn-cancel-settings'),
  
  modalAutomationMappings: document.getElementById('modal-automation-mappings'),
  btnOpenMappings: document.getElementById('btn-open-mappings'),
  btnCloseMappings: document.getElementById('btn-close-mappings'),
  btnCloseMappingsFooter: document.getElementById('btn-close-mappings-footer'),
  btnAddMappingGroup: document.getElementById('btn-add-mapping-group'),
  mappingsTbody: document.getElementById('mappings-tbody'),
  inAutomationTest: document.getElementById('in-automation-test'),
  btnRunAutomationTest: document.getElementById('btn-run-automation-test'),
  
  modalEditMappingGroup: document.getElementById('modal-edit-mapping-group'),
  btnCloseGroup: document.getElementById('btn-close-group'),
  btnCancelGroup: document.getElementById('btn-cancel-group'),
  btnSaveGroup: document.getElementById('btn-save-group'),
  btnAddGroupCommand: document.getElementById('btn-add-group-command'),
  groupCommandsTbody: document.getElementById('group-commands-tbody'),
  groupPrefixInput: document.getElementById('group-prefix-input'),
  groupTitleInput: document.getElementById('group-title-input'),
  modalGroupTitle: document.getElementById('modal-group-title'),

  scanResult: document.getElementById('scan-result'),
  
  inIp: document.getElementById('setting-ip'),
  inPort: document.getElementById('setting-port'),
  inStation: document.getElementById('setting-station'),
  inKey: document.getElementById('setting-apikey'),
  inToken: document.getElementById('setting-apitoken'),
  inAutomationColumn: document.getElementById('setting-automation-column'),
  inShowdir: document.getElementById('setting-showdir'),
  inDefaultsdir: document.getElementById('setting-defaultsdir'),
  inVmixip: document.getElementById('setting-vmixip'),
  inPrefix: document.getElementById('setting-prefix') || document.getElementById('in-prefix'),
  inFirstLoc: document.getElementById('setting-firstloc'),
  inPoolSize: document.getElementById('setting-poolsize'),
  inProtectProgram: document.getElementById('setting-protect-program'),
  inUse24Hr: document.getElementById('setting-use-24hr'),
  inFadeDuration: document.getElementById('setting-fade-duration'),
  
  btnScanDefaults: document.getElementById('btn-scan-defaults'),
  btnSelectShowdir: document.getElementById('btn-select-showdir'),
  btnSelectDefaultsdir: document.getElementById('btn-select-defaultsdir'),
  
  modalScript: document.getElementById('modal-script'),
  modalScriptTitle: document.getElementById('modal-script-title'),
  modalScriptContent: document.getElementById('modal-script-content'),
  btnCloseScript: document.getElementById('btn-close-script'),
  btnEditScript: document.getElementById('btn-edit-script'),
  btnSaveScript: document.getElementById('btn-save-script'),
  btnCancelScript: document.getElementById('btn-cancel-script'),
  btnCapsScript: document.getElementById('btn-caps-script'),
  
  modalConfirm: document.getElementById('modal-confirm'),
  btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
  btnConfirmOk: document.getElementById('btn-confirm-ok'),
  modalConfirmMsg: document.getElementById('modal-confirm-msg'),
  
  btnLoadCsv: document.getElementById('btn-load-csv'),
  btnInit: document.getElementById('btn-init'),
  btnLoadBlock: document.getElementById('btn-load-block'),
  btnLoadElement: document.getElementById('btn-load-element'),
  
  inCurrentIndex: document.getElementById('current-index-input'),
  
  contextMenu: document.getElementById('context-menu'),
  menuAddElementAbove: document.getElementById('menu-add-element-above'),
  menuAddElementBelow: document.getElementById('menu-add-element-below'),
  menuAddElement: document.getElementById('menu-add-element'),
  menuEditElement: document.getElementById('menu-edit-element'),
  menuRemoveElement: document.getElementById('menu-remove-element'),
  menuDividerRemove: document.getElementById('menu-divider-remove'),
  menuDividerAdd: document.getElementById('menu-divider-add'),
  menuMarkPrevLoaded: document.getElementById('menu-mark-prev-loaded'),
  menuMarkLoaded: document.getElementById('menu-mark-loaded'),
  menuMarkUnloaded: document.getElementById('menu-mark-unloaded'),
  menuMarkFutureUnloaded: document.getElementById('menu-mark-future-unloaded'),
  menuMarkFloated: document.getElementById('menu-mark-floated'),
  menuStartTimer: document.getElementById('menu-start-timer')
};
