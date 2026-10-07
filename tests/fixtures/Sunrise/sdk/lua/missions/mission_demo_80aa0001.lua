-- Made-up stand-in for a generated mission module. The table names follow the docs
-- ("The generated SDK modules"); the exact file layout is a guess.
local M = {}
M.states = {
    STATE_80AA0001_0001_0000_80AA00A1 = { id = "state/80aa0001/0001/0000/80aa00a1", region_index = 0 },
    STATE_80AA0001_0002_0000_80AA00A2 = { id = "state/80aa0001/0002/0000/80aa00a2", region_index = 8 },
    STATE_80AA0001_0003_0000_80AA00A3 = { id = "state/80aa0001/0003/0000/80aa00a3", region_index = 16 },
}
M.Slot = {
    M_DIRECTIVE_SENSOR_80AA0001 = "slot/80aa1000/0000/0000/68",
    M_DIALOG_SENSOR_80AA0001 = "slot/80aa1000/0000/0001/53",
    PF_OPENING_CINEMATIC = "slot/80aa1001/0000/0000/6",
    PT_GATE = "slot/80aa1002/0000/0001/31",
    PT_EXIT = "slot/80aa1002/0000/0002/31",
    PT_SWITCH_ROOM = "slot/80aa1002/0000/0003/31",
    TV_GATE_APPROACH = "slot/80aa1002/0000/0004/60",
    AP_GATE = "slot/80aa1003/0000/0000/47",
    AP_SWITCH = "slot/80aa1003/0000/0001/47",
    D_YARD_LIGHTS = "slot/80aa1004/0000/0000/23",
    D_SWITCH_DOOR = "slot/80aa1004/0000/0001/23",
    D_SWITCH = "slot/80aa1004/0000/0002/23",
    O_SWITCH = "slot/80aa1005/0000/0000/4",
    OBJ_YARD = "slot/80aa1006/0000/0000/3",
    MUSIC_SENSOR = "slot/80aa1007/0000/0000/11",
    SQ_GREETER = "slot/80aa1008/0000/0000/1",
    SQ_YARD_A = "slot/80aa1008/0000/0001/1",
    SQ_YARD_B = "slot/80aa1008/0000/0002/1",
}
M.Squad = {
    SQ_GREETER = "squad/80aa1008/0000",
    SQ_YARD_A = "squad/80aa1008/0001",
    SQ_YARD_B = "squad/80aa1008/0002",
}
M.Directive = {
    REACH_THE_GATE = { id = "directive/1", slot_row = 0, title = "Reach the gate" },
    CLEAR_THE_YARD = { id = "directive/2", slot_row = 0, title = "Clear the yard" },
    OPEN_THE_WAY_OUT = { id = "directive/3", slot_row = 0, title = "Open the way out" },
    LEAVE_THE_YARD = { id = "directive/4", slot_row = 0, title = "Leave the yard" },
}
M.DialogueCue = {
    M_DIALOG_SENSOR_80AA0001 = {
        CUE_1 = 1,
        CUE_2 = 2,
        CUE_4 = 4,
    },
}
return M
