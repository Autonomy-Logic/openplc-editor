PROGRAM Parallel
  VAR
    TON0 : TON;
    h05_out : BOOL;
    CTU0 : CTU;
    h05_a : BOOL;
    h05_b : BOOL;
    h05_r : BOOL;
    h06_en : BOOL;
    h06_y1 : BOOL;
    h06_y2 : BOOL;
    h06_y3 : BOOL;
    h06_y4 : BOOL;
    TON1 : TON;
    h06_a1 : BOOL;
    TOF0 : TOF;
    h06_b1 : BOOL;
    CTU1 : CTU;
    h06_c1 : BOOL;
    h06_r : BOOL;
    h06_cv : INT;
    h09_out : BOOL;
    TON2 : TON;
    TOF1 : TOF;
    h09_a : BOOL;
    h09_b : BOOL;
    h09_c : BOOL;
    h09_d : BOOL;
  END_VAR

{
  "name": "Parallel",
  "rungs": [
    {
      "id": "rung_Parallel_b3fedf7a-41dc-49d1-8b3b-b215600fab9d",
      "comment": "H05 two-blocks-parallel-branches",
      "defaultBounds": [
        300,
        100
      ],
      "reactFlowViewport": [
        637,
        318
      ],
      "nodes": [
        {
          "id": "left-rail-rung_Parallel_b3fedf7a-41dc-49d1-8b3b-b215600fab9d",
          "type": "powerRail",
          "position": {
            "x": 0,
            "y": 30
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 3,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "left-rail",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "right": -3
                }
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 3,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "left-rail",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "right": -3
                }
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 3,
                "y": 50
              },
              "relPosition": {
                "x": 3,
                "y": 20
              },
              "id": "left-rail",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 20,
                "right": -3
              }
            },
            "numericId": "8028583",
            "variant": "left",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 3,
          "height": 40,
          "measured": {
            "width": 3,
            "height": 40
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_OPEN_6421e0bf-9d6a-4a39-aef6-7d5c68f0c2bb",
          "type": "parallel",
          "position": {
            "x": 23,
            "y": 49
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 23,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 23,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 23,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 27,
                "y": 50
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "5802674",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 27,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "input-top",
              "position": "top",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 27,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "output-down",
              "position": "bottom",
              "type": "source",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelCloseReference": "PARALLEL_CLOSE_248584b9-204f-482c-a2b1-8eb88f2bc391",
            "type": "open",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_27c131fe-53ad-445b-b228-8e56028c7f0b",
          "type": "contact",
          "position": {
            "x": 72,
            "y": 38
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 72,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 96,
                  "y": 50
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 72,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 96,
                  "y": 50
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 72,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 96,
                "y": 50
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "7142155",
            "variable": {
              "id": "6b5bd937-6568-4ba6-a6dd-04d5e7509b55",
              "name": "h05_a",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac",
          "type": "block",
          "position": {
            "x": 261,
            "y": 14
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 261,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 50
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 90
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 261,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 327,
                  "y": 50
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 90
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 261,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 36
              },
              "id": "IN",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 36,
                "left": 0
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 327,
                "y": 50
              },
              "relPosition": {
                "x": 66,
                "y": 36
              },
              "id": "Q",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 36,
                "right": 0
              }
            },
            "numericId": "2286553",
            "variant": {
              "name": "TON",
              "type": "function-block",
              "variables": [
                {
                  "name": "IN",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "PT",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                },
                {
                  "name": "Q",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "ET",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                }
              ],
              "documentation": "The on-delay timer can be used to delay setting an output true, for fixed period after an input becomes true.",
              "extensible": false
            },
            "variable": {
              "id": "1624ef4a-865e-463c-8340-c8d4c48f6844",
              "name": "TON0",
              "type": {
                "definition": "derived",
                "value": "TON"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "executionControl": false,
            "lockExecutionControl": false,
            "connectedVariables": [
              {
                "handleId": "PT",
                "type": "input",
                "variable": {
                  "name": "T#1s"
                }
              }
            ],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 66,
          "height": 100,
          "measured": {
            "width": 66,
            "height": 100
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_def4ed7d-8e16-4f6b-8ab9-d742e33d16c9",
          "type": "contact",
          "position": {
            "x": 72,
            "y": 182
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 72,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 96,
                  "y": 194
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 72,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 96,
                  "y": 194
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 72,
                "y": 194
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 96,
                "y": 194
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "7997932",
            "variable": {
              "id": "5c4abb53-b3d3-4633-9522-4f1258b57999",
              "name": "h05_b",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5",
          "type": "block",
          "position": {
            "x": 261,
            "y": 158
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 261,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "CU",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "R",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 274
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "PV",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 194
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 234
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "CV",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 261,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "CU",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "R",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 274
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "PV",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 327,
                  "y": 194
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 234
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "CV",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 261,
                "y": 194
              },
              "relPosition": {
                "x": 0,
                "y": 36
              },
              "id": "CU",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 36,
                "left": 0
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 327,
                "y": 194
              },
              "relPosition": {
                "x": 66,
                "y": 36
              },
              "id": "Q",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 36,
                "right": 0
              }
            },
            "numericId": "4213592",
            "variant": {
              "name": "CTU",
              "type": "function-block",
              "variables": [
                {
                  "name": "CU",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "R",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "PV",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "INT"
                  }
                },
                {
                  "name": "Q",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "CV",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "INT"
                  }
                }
              ],
              "documentation": "The up-counter can be used to signal when a count has reached a maximum value.",
              "extensible": false
            },
            "variable": {
              "id": "f50ca980-ecf4-4744-88d5-9f86eeff1e9f",
              "name": "CTU0",
              "type": {
                "definition": "derived",
                "value": "CTU"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "executionControl": false,
            "lockExecutionControl": false,
            "connectedVariables": [
              {
                "handleId": "R",
                "type": "input",
                "variable": {
                  "id": "6824d76e-f714-4919-a28a-8b931b80885e",
                  "name": "h05_r",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  },
                  "class": "local",
                  "location": "",
                  "documentation": "",
                  "debug": false
                }
              },
              {
                "handleId": "PV",
                "type": "input",
                "variable": {
                  "name": "5"
                }
              }
            ],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 66,
          "height": 140,
          "measured": {
            "width": 66,
            "height": 140
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_CLOSE_248584b9-204f-482c-a2b1-8eb88f2bc391",
          "type": "parallel",
          "position": {
            "x": 447,
            "y": 49
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 447,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 447,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 447,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 451,
                "y": 50
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "7238043",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 451,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "input-down",
              "position": "bottom",
              "type": "target",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 451,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "output-top",
              "position": "top",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOpenReference": "PARALLEL_OPEN_6421e0bf-9d6a-4a39-aef6-7d5c68f0c2bb",
            "type": "close",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "COIL_c45d2a82-58c1-4d25-abd2-136d7e92b884",
          "type": "coil",
          "position": {
            "x": 496,
            "y": 38
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 496,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 524,
                  "y": 50
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 496,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 524,
                  "y": 50
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 496,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 524,
                "y": 50
              },
              "relPosition": {
                "x": 28,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "9159157",
            "variable": {
              "id": "d2c27790-11fa-433c-a463-5fa49072f543",
              "name": "h05_out",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 28,
          "height": 24,
          "measured": {
            "width": 28,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "right-rail-rung_Parallel_b3fedf7a-41dc-49d1-8b3b-b215600fab9d",
          "type": "powerRail",
          "position": {
            "x": 634,
            "y": 30
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 297,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "right-rail",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "left": -3
                },
                "x": 634
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 297,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "right-rail",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "left": -3
                }
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 297,
                "y": 50
              },
              "relPosition": {
                "x": 3,
                "y": 20
              },
              "id": "right-rail",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 20,
                "left": -3
              }
            },
            "numericId": "4510732",
            "variant": "right",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 3,
          "height": 40,
          "measured": {
            "width": 3,
            "height": 40
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_9320462d-3971-4e16-a767-e0059df19c4b",
          "type": "variable",
          "position": {
            "x": 151,
            "y": 74
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 311,
                "y": 90
              },
              "relPosition": {
                "x": 80,
                "y": 16
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source"
            },
            "numericId": "3461668",
            "variable": {
              "name": "T#1s"
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac",
              "handleId": "PT",
              "variableType": {
                "name": "PT",
                "class": "input",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_1ff15544-d7bf-4f17-a85b-4d8605cc69fc",
          "type": "variable",
          "position": {
            "x": 357,
            "y": 74
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 357,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 357,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 357,
                "y": 90
              },
              "relPosition": {
                "x": 0,
                "y": 16
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target"
            },
            "numericId": "710606",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac",
              "handleId": "ET",
              "variableType": {
                "name": "ET",
                "class": "output",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_ab4c1f6f-6e66-4af3-8150-30941568bec0",
          "type": "variable",
          "position": {
            "x": 151,
            "y": 218
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 234
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 234
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 311,
                "y": 234
              },
              "relPosition": {
                "x": 80,
                "y": 16
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source"
            },
            "numericId": "1501974",
            "variable": {
              "id": "6824d76e-f714-4919-a28a-8b931b80885e",
              "name": "h05_r",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5",
              "handleId": "R",
              "variableType": {
                "name": "R",
                "class": "input",
                "type": {
                  "definition": "base-type",
                  "value": "BOOL"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_3f3c3c47-2d96-407a-9a4f-548044d6b06f",
          "type": "variable",
          "position": {
            "x": 151,
            "y": 258
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 274
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 274
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 311,
                "y": 274
              },
              "relPosition": {
                "x": 80,
                "y": 16
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source"
            },
            "numericId": "206905",
            "variable": {
              "name": "5"
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5",
              "handleId": "PV",
              "variableType": {
                "name": "PV",
                "class": "input",
                "type": {
                  "definition": "base-type",
                  "value": "INT"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_9afe2050-d767-4f94-97cb-969abba30257",
          "type": "variable",
          "position": {
            "x": 357,
            "y": 218
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 357,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 357,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 357,
                "y": 234
              },
              "relPosition": {
                "x": 0,
                "y": 16
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target"
            },
            "numericId": "2513783",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5",
              "handleId": "CV",
              "variableType": {
                "name": "CV",
                "class": "output",
                "type": {
                  "definition": "base-type",
                  "value": "INT"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        }
      ],
      "edges": [
        {
          "id": "e_COIL_c45d2a82-58c1-4d25-abd2-136d7e92b884_right-rail-rung_Parallel_b3fedf7a-41dc-49d1-8b3b-b215600fab9d__output_right-rail",
          "source": "COIL_c45d2a82-58c1-4d25-abd2-136d7e92b884",
          "target": "right-rail-rung_Parallel_b3fedf7a-41dc-49d1-8b3b-b215600fab9d",
          "sourceHandle": "output",
          "targetHandle": "right-rail"
        },
        {
          "id": "e_left-rail-rung_Parallel_b3fedf7a-41dc-49d1-8b3b-b215600fab9d_PARALLEL_OPEN_6421e0bf-9d6a-4a39-aef6-7d5c68f0c2bb__left-rail_input",
          "source": "left-rail-rung_Parallel_b3fedf7a-41dc-49d1-8b3b-b215600fab9d",
          "target": "PARALLEL_OPEN_6421e0bf-9d6a-4a39-aef6-7d5c68f0c2bb",
          "sourceHandle": "left-rail",
          "targetHandle": "input"
        },
        {
          "id": "e_BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac_PARALLEL_CLOSE_248584b9-204f-482c-a2b1-8eb88f2bc391__Q_input",
          "source": "BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac",
          "target": "PARALLEL_CLOSE_248584b9-204f-482c-a2b1-8eb88f2bc391",
          "sourceHandle": "Q",
          "targetHandle": "input"
        },
        {
          "id": "e_BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5_PARALLEL_CLOSE_248584b9-204f-482c-a2b1-8eb88f2bc391__Q_input-down",
          "source": "BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5",
          "target": "PARALLEL_CLOSE_248584b9-204f-482c-a2b1-8eb88f2bc391",
          "sourceHandle": "Q",
          "targetHandle": "input-down"
        },
        {
          "id": "e_PARALLEL_CLOSE_248584b9-204f-482c-a2b1-8eb88f2bc391_COIL_c45d2a82-58c1-4d25-abd2-136d7e92b884__output-right_input",
          "source": "PARALLEL_CLOSE_248584b9-204f-482c-a2b1-8eb88f2bc391",
          "target": "COIL_c45d2a82-58c1-4d25-abd2-136d7e92b884",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_6421e0bf-9d6a-4a39-aef6-7d5c68f0c2bb_CONTACT_27c131fe-53ad-445b-b228-8e56028c7f0b__output-right_input",
          "source": "PARALLEL_OPEN_6421e0bf-9d6a-4a39-aef6-7d5c68f0c2bb",
          "target": "CONTACT_27c131fe-53ad-445b-b228-8e56028c7f0b",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_27c131fe-53ad-445b-b228-8e56028c7f0b_BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac__output_IN",
          "source": "CONTACT_27c131fe-53ad-445b-b228-8e56028c7f0b",
          "target": "BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac",
          "sourceHandle": "output",
          "targetHandle": "IN"
        },
        {
          "id": "e_PARALLEL_OPEN_6421e0bf-9d6a-4a39-aef6-7d5c68f0c2bb_CONTACT_def4ed7d-8e16-4f6b-8ab9-d742e33d16c9__output-down_input",
          "source": "PARALLEL_OPEN_6421e0bf-9d6a-4a39-aef6-7d5c68f0c2bb",
          "target": "CONTACT_def4ed7d-8e16-4f6b-8ab9-d742e33d16c9",
          "sourceHandle": "output-down",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_def4ed7d-8e16-4f6b-8ab9-d742e33d16c9_BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5__output_CU",
          "source": "CONTACT_def4ed7d-8e16-4f6b-8ab9-d742e33d16c9",
          "target": "BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5",
          "sourceHandle": "output",
          "targetHandle": "CU"
        },
        {
          "id": "e_VARIABLE_9320462d-3971-4e16-a767-e0059df19c4b_BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac__output_PT",
          "source": "VARIABLE_9320462d-3971-4e16-a767-e0059df19c4b",
          "target": "BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac",
          "sourceHandle": "output",
          "targetHandle": "PT"
        },
        {
          "id": "e_BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac_VARIABLE_1ff15544-d7bf-4f17-a85b-4d8605cc69fc__ET_input",
          "source": "BLOCK_fdc2981a-4a3d-4e4f-87eb-481a9890a6ac",
          "target": "VARIABLE_1ff15544-d7bf-4f17-a85b-4d8605cc69fc",
          "sourceHandle": "ET",
          "targetHandle": "input"
        },
        {
          "id": "e_VARIABLE_ab4c1f6f-6e66-4af3-8150-30941568bec0_BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5__output_R",
          "source": "VARIABLE_ab4c1f6f-6e66-4af3-8150-30941568bec0",
          "target": "BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5",
          "sourceHandle": "output",
          "targetHandle": "R"
        },
        {
          "id": "e_VARIABLE_3f3c3c47-2d96-407a-9a4f-548044d6b06f_BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5__output_PV",
          "source": "VARIABLE_3f3c3c47-2d96-407a-9a4f-548044d6b06f",
          "target": "BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5",
          "sourceHandle": "output",
          "targetHandle": "PV"
        },
        {
          "id": "e_BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5_VARIABLE_9afe2050-d767-4f94-97cb-969abba30257__CV_input",
          "source": "BLOCK_4aad3247-bf2e-4fdb-814e-75c985f18cd5",
          "target": "VARIABLE_9afe2050-d767-4f94-97cb-969abba30257",
          "sourceHandle": "CV",
          "targetHandle": "input"
        }
      ],
      "selectedNodes": []
    },
    {
      "id": "rung_Parallel_392fe717-c7f7-45b2-9c8e-088930d9d8a1",
      "comment": "H06 three-blocks-parallel-branches",
      "defaultBounds": [
        300,
        100
      ],
      "reactFlowViewport": [
        747,
        554
      ],
      "nodes": [
        {
          "id": "left-rail-rung_Parallel_392fe717-c7f7-45b2-9c8e-088930d9d8a1",
          "type": "powerRail",
          "position": {
            "x": 0,
            "y": 30
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 3,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "left-rail",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "right": -3
                }
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 3,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "left-rail",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "right": -3
                }
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 3,
                "y": 50
              },
              "relPosition": {
                "x": 3,
                "y": 20
              },
              "id": "left-rail",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 20,
                "right": -3
              }
            },
            "numericId": "2819749",
            "variant": "left",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 3,
          "height": 40,
          "measured": {
            "width": 3,
            "height": 40
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_8b4cba33-0519-447d-8cf5-15daf3155cc5",
          "type": "contact",
          "position": {
            "x": 68,
            "y": 38
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 68,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 92,
                  "y": 50
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 68,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 92,
                  "y": 50
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 68,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 92,
                "y": 50
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "7126490",
            "variable": {
              "id": "ad52395c-d95a-41e5-99b1-054a00a12405",
              "name": "h06_en",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_OPEN_34d00ef5-9b9c-4886-87b6-58e702a97d0b",
          "type": "parallel",
          "position": {
            "x": 137,
            "y": 49
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 137,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 137,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 141,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 137,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 141,
                "y": 50
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "3850645",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 141,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "input-top",
              "position": "top",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 141,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "output-down",
              "position": "bottom",
              "type": "source",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelCloseReference": "PARALLEL_CLOSE_7e3ba027-02c3-4667-be8c-a670a6160fa7",
            "type": "open",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_5052cae2-fc40-484e-96b2-a3e66f47c49a",
          "type": "contact",
          "position": {
            "x": 186,
            "y": 38
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 186,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 210,
                  "y": 50
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 186,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 210,
                  "y": 50
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 186,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 210,
                "y": 50
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "6927447",
            "variable": {
              "id": "8d6de182-54d3-463f-b110-535cbeaef167",
              "name": "h06_a1",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "BLOCK_272cfd34-6843-45cd-9522-eda23347612d",
          "type": "block",
          "position": {
            "x": 375,
            "y": 14
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 375,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 375,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 441,
                  "y": 50
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 441,
                  "y": 90
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 375,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 375,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 441,
                  "y": 50
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 441,
                  "y": 90
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 375,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 36
              },
              "id": "IN",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 36,
                "left": 0
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 441,
                "y": 50
              },
              "relPosition": {
                "x": 66,
                "y": 36
              },
              "id": "Q",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 36,
                "right": 0
              }
            },
            "numericId": "4936694",
            "variant": {
              "name": "TON",
              "type": "function-block",
              "variables": [
                {
                  "name": "IN",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "PT",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                },
                {
                  "name": "Q",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "ET",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                }
              ],
              "documentation": "The on-delay timer can be used to delay setting an output true, for fixed period after an input becomes true.",
              "extensible": false
            },
            "variable": {
              "id": "5fc6b0a5-394b-4ad9-87b2-3f74f54fb626",
              "name": "TON1",
              "type": {
                "definition": "derived",
                "value": "TON"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "executionControl": false,
            "lockExecutionControl": false,
            "connectedVariables": [
              {
                "handleId": "PT",
                "type": "input",
                "variable": {
                  "name": "T#1s"
                }
              }
            ],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 66,
          "height": 100,
          "measured": {
            "width": 66,
            "height": 100
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "COIL_e57a29f7-e338-40ab-838c-d09acfde5d8a",
          "type": "coil",
          "position": {
            "x": 606,
            "y": 38
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 606,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 634,
                  "y": 50
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 606,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 634,
                  "y": 50
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 606,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 634,
                "y": 50
              },
              "relPosition": {
                "x": 28,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "4079711",
            "variable": {
              "id": "627fc4a7-5904-4de5-a819-486b2eb4c90c",
              "name": "h06_y1",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 28,
          "height": 24,
          "measured": {
            "width": 28,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_OPEN_955a392e-2e7e-4c45-8dca-4d7530ef4d6d",
          "type": "parallel",
          "position": {
            "x": 137,
            "y": 193
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 137,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 194
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 194
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 194
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 137,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 194
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 141,
                  "y": 194
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 194
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 137,
                "y": 194
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 141,
                "y": 194
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "8854636",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 141,
                "y": 194
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "input-top",
              "position": "top",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 141,
                "y": 194
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "output-down",
              "position": "bottom",
              "type": "source",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelCloseReference": "PARALLEL_CLOSE_ae2bc724-ad07-4a02-8467-b5cbf3d0abb0",
            "type": "open",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_ec714b4b-7084-41ec-995f-092c963a2bed",
          "type": "contact",
          "position": {
            "x": 186,
            "y": 182
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 186,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 210,
                  "y": 194
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 186,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 210,
                  "y": 194
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 186,
                "y": 194
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 210,
                "y": 194
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "8002603",
            "variable": {
              "id": "5995d6dc-65d6-492c-b978-2d3ae0b4422f",
              "name": "h06_b1",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8",
          "type": "block",
          "position": {
            "x": 375,
            "y": 158
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 375,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 375,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 441,
                  "y": 194
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 441,
                  "y": 234
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 375,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 375,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 441,
                  "y": 194
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 441,
                  "y": 234
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 375,
                "y": 194
              },
              "relPosition": {
                "x": 0,
                "y": 36
              },
              "id": "IN",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 36,
                "left": 0
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 441,
                "y": 194
              },
              "relPosition": {
                "x": 66,
                "y": 36
              },
              "id": "Q",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 36,
                "right": 0
              }
            },
            "numericId": "1376675",
            "variant": {
              "name": "TOF",
              "type": "function-block",
              "variables": [
                {
                  "name": "IN",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "PT",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                },
                {
                  "name": "Q",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "ET",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                }
              ],
              "documentation": "The off-delay timer can be used to delay setting an output false, for fixed period after input goes false.",
              "extensible": false
            },
            "variable": {
              "id": "b4819fc1-d858-465f-bb62-7fe65f3f3020",
              "name": "TOF0",
              "type": {
                "definition": "derived",
                "value": "TOF"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "executionControl": false,
            "lockExecutionControl": false,
            "connectedVariables": [
              {
                "handleId": "PT",
                "type": "input",
                "variable": {
                  "name": "T#2s"
                }
              }
            ],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 66,
          "height": 100,
          "measured": {
            "width": 66,
            "height": 100
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "COIL_0e8e36eb-423b-4610-8418-ec6fc7f819d5",
          "type": "coil",
          "position": {
            "x": 606,
            "y": 182
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 606,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 634,
                  "y": 194
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 606,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 634,
                  "y": 194
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 606,
                "y": 194
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 634,
                "y": 194
              },
              "relPosition": {
                "x": 28,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "6680217",
            "variable": {
              "id": "f20257f8-0c0a-4104-aa46-c3e67b4609dc",
              "name": "h06_y2",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 28,
          "height": 24,
          "measured": {
            "width": 28,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_OPEN_0b222bdc-53c5-4dfe-ad0e-6c941d45a212",
          "type": "parallel",
          "position": {
            "x": 137,
            "y": 337
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 137,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 338
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 338
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 338
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 137,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 338
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 141,
                  "y": 338
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 141,
                  "y": 338
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 137,
                "y": 338
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 141,
                "y": 338
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "9326896",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 141,
                "y": 338
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "input-top",
              "position": "top",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 141,
                "y": 338
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "output-down",
              "position": "bottom",
              "type": "source",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelCloseReference": "PARALLEL_CLOSE_40b3b8d7-78de-49c7-b538-0b3a5469b1c5",
            "type": "open",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_0b750ebd-4f17-41e1-820b-3c0a08bfb7a4",
          "type": "contact",
          "position": {
            "x": 186,
            "y": 326
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 186,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 210,
                  "y": 338
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 186,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 210,
                  "y": 338
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 186,
                "y": 338
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 210,
                "y": 338
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "4525824",
            "variable": {
              "id": "f1b05afa-65b3-4078-bac9-7c3265359436",
              "name": "h06_c1",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7",
          "type": "block",
          "position": {
            "x": 375,
            "y": 302
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 375,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "CU",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 375,
                  "y": 378
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "R",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 375,
                  "y": 418
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "PV",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 441,
                  "y": 338
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 441,
                  "y": 378
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "CV",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 375,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "CU",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 375,
                  "y": 378
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "R",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 375,
                  "y": 418
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "PV",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 441,
                  "y": 338
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 441,
                  "y": 378
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "CV",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 375,
                "y": 338
              },
              "relPosition": {
                "x": 0,
                "y": 36
              },
              "id": "CU",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 36,
                "left": 0
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 441,
                "y": 338
              },
              "relPosition": {
                "x": 66,
                "y": 36
              },
              "id": "Q",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 36,
                "right": 0
              }
            },
            "numericId": "7448965",
            "variant": {
              "name": "CTU",
              "type": "function-block",
              "variables": [
                {
                  "name": "CU",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "R",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "PV",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "INT"
                  }
                },
                {
                  "name": "Q",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "CV",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "INT"
                  }
                }
              ],
              "documentation": "The up-counter can be used to signal when a count has reached a maximum value.",
              "extensible": false
            },
            "variable": {
              "id": "1a9cbae6-42ff-49e7-a377-6589c924525e",
              "name": "CTU1",
              "type": {
                "definition": "derived",
                "value": "CTU"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "executionControl": false,
            "lockExecutionControl": false,
            "connectedVariables": [
              {
                "handleId": "R",
                "type": "input",
                "variable": {
                  "id": "5a5377f2-b2bf-455b-b06d-de3caa6df92c",
                  "name": "h06_r",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  },
                  "class": "local",
                  "location": "",
                  "documentation": "",
                  "debug": false
                }
              },
              {
                "handleId": "PV",
                "type": "input",
                "variable": {
                  "name": "7"
                }
              },
              {
                "handleId": "CV",
                "type": "output",
                "variable": {
                  "id": "77d372c2-c0b5-46a7-9565-1cf046f95cf3",
                  "name": "h06_cv",
                  "type": {
                    "definition": "base-type",
                    "value": "INT"
                  },
                  "class": "local",
                  "location": "",
                  "documentation": "",
                  "debug": false
                }
              }
            ],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 66,
          "height": 140,
          "measured": {
            "width": 66,
            "height": 140
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "COIL_0f49268e-e1e4-4dc0-81d6-040eb2433c25",
          "type": "coil",
          "position": {
            "x": 606,
            "y": 326
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 606,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 634,
                  "y": 338
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 606,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 634,
                  "y": 338
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 606,
                "y": 338
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 634,
                "y": 338
              },
              "relPosition": {
                "x": 28,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "721485",
            "variable": {
              "id": "2a11b52e-f3d7-4052-8e30-884fb09f5704",
              "name": "h06_y3",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 28,
          "height": 24,
          "measured": {
            "width": 28,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "COIL_938eb783-70da-4f1d-8bf0-042df8df6f1a",
          "type": "coil",
          "position": {
            "x": 186,
            "y": 510
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 186,
                  "y": 522
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 214,
                  "y": 522
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 186,
                  "y": 522
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 214,
                  "y": 522
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 186,
                "y": 522
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 214,
                "y": 522
              },
              "relPosition": {
                "x": 28,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "7507209",
            "variable": {
              "id": "ea7888cf-ce05-44ef-887c-2f5a232db588",
              "name": "h06_y4",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 28,
          "height": 24,
          "measured": {
            "width": 28,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_CLOSE_40b3b8d7-78de-49c7-b538-0b3a5469b1c5",
          "type": "parallel",
          "position": {
            "x": 679,
            "y": 337
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 679,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 338
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 338
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 338
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 679,
                  "y": 338
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 338
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 683,
                  "y": 338
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 338
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 679,
                "y": 338
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 683,
                "y": 338
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "1073145",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 683,
                "y": 338
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "input-down",
              "position": "bottom",
              "type": "target",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 683,
                "y": 338
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "output-top",
              "position": "top",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOpenReference": "PARALLEL_OPEN_0b222bdc-53c5-4dfe-ad0e-6c941d45a212",
            "type": "close",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_CLOSE_ae2bc724-ad07-4a02-8467-b5cbf3d0abb0",
          "type": "parallel",
          "position": {
            "x": 679,
            "y": 193
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 679,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 194
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 194
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 194
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 679,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 194
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 683,
                  "y": 194
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 194
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 679,
                "y": 194
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 683,
                "y": 194
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "7018898",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 683,
                "y": 194
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "input-down",
              "position": "bottom",
              "type": "target",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 683,
                "y": 194
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "output-top",
              "position": "top",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOpenReference": "PARALLEL_OPEN_955a392e-2e7e-4c45-8dca-4d7530ef4d6d",
            "type": "close",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_CLOSE_7e3ba027-02c3-4667-be8c-a670a6160fa7",
          "type": "parallel",
          "position": {
            "x": 679,
            "y": 49
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 679,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 679,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 683,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 683,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 679,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 683,
                "y": 50
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "7615275",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 683,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "input-down",
              "position": "bottom",
              "type": "target",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 683,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "output-top",
              "position": "top",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOpenReference": "PARALLEL_OPEN_34d00ef5-9b9c-4886-87b6-58e702a97d0b",
            "type": "close",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "right-rail-rung_Parallel_392fe717-c7f7-45b2-9c8e-088930d9d8a1",
          "type": "powerRail",
          "position": {
            "x": 744,
            "y": 30
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 297,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "right-rail",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "left": -3
                },
                "x": 744
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 297,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "right-rail",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "left": -3
                }
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 297,
                "y": 50
              },
              "relPosition": {
                "x": 3,
                "y": 20
              },
              "id": "right-rail",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 20,
                "left": -3
              }
            },
            "numericId": "4505826",
            "variant": "right",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 3,
          "height": 40,
          "measured": {
            "width": 3,
            "height": 40
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_64355984-ade5-41c5-bdc4-cb6b48e25ac6",
          "type": "variable",
          "position": {
            "x": 265,
            "y": 74
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 425,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 425,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 425,
                "y": 90
              },
              "relPosition": {
                "x": 80,
                "y": 16
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source"
            },
            "numericId": "6761381",
            "variable": {
              "name": "T#1s"
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_272cfd34-6843-45cd-9522-eda23347612d",
              "handleId": "PT",
              "variableType": {
                "name": "PT",
                "class": "input",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_8f975ff1-7b7b-49bf-8a0d-76ca425dd729",
          "type": "variable",
          "position": {
            "x": 471,
            "y": 74
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 471,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 471,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 471,
                "y": 90
              },
              "relPosition": {
                "x": 0,
                "y": 16
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target"
            },
            "numericId": "5372640",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_272cfd34-6843-45cd-9522-eda23347612d",
              "handleId": "ET",
              "variableType": {
                "name": "ET",
                "class": "output",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_0f2f55ea-6d3a-44f0-85d6-c4cc8012399b",
          "type": "variable",
          "position": {
            "x": 265,
            "y": 218
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 425,
                  "y": 234
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 425,
                  "y": 234
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 425,
                "y": 234
              },
              "relPosition": {
                "x": 80,
                "y": 16
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source"
            },
            "numericId": "1475963",
            "variable": {
              "name": "T#2s"
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8",
              "handleId": "PT",
              "variableType": {
                "name": "PT",
                "class": "input",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_52238cd0-cb2d-43e3-87d7-0014f2017bd9",
          "type": "variable",
          "position": {
            "x": 471,
            "y": 218
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 471,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 471,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 471,
                "y": 234
              },
              "relPosition": {
                "x": 0,
                "y": 16
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target"
            },
            "numericId": "5538644",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8",
              "handleId": "ET",
              "variableType": {
                "name": "ET",
                "class": "output",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_7394396b-01a4-403a-973b-97b686ed0632",
          "type": "variable",
          "position": {
            "x": 265,
            "y": 362
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 425,
                  "y": 378
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 425,
                  "y": 378
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 425,
                "y": 378
              },
              "relPosition": {
                "x": 80,
                "y": 16
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source"
            },
            "numericId": "6159803",
            "variable": {
              "id": "5a5377f2-b2bf-455b-b06d-de3caa6df92c",
              "name": "h06_r",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7",
              "handleId": "R",
              "variableType": {
                "name": "R",
                "class": "input",
                "type": {
                  "definition": "base-type",
                  "value": "BOOL"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_1489c0b9-3fab-428f-ad80-74d492902c97",
          "type": "variable",
          "position": {
            "x": 265,
            "y": 402
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 425,
                  "y": 418
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 425,
                  "y": 418
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 425,
                "y": 418
              },
              "relPosition": {
                "x": 80,
                "y": 16
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source"
            },
            "numericId": "3126941",
            "variable": {
              "name": "7"
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7",
              "handleId": "PV",
              "variableType": {
                "name": "PV",
                "class": "input",
                "type": {
                  "definition": "base-type",
                  "value": "INT"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_91af9bf4-1629-4238-b83b-4e6845e6e3ee",
          "type": "variable",
          "position": {
            "x": 471,
            "y": 362
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 471,
                  "y": 378
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 471,
                  "y": 378
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 471,
                "y": 378
              },
              "relPosition": {
                "x": 0,
                "y": 16
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target"
            },
            "numericId": "2270487",
            "variable": {
              "id": "77d372c2-c0b5-46a7-9565-1cf046f95cf3",
              "name": "h06_cv",
              "type": {
                "definition": "base-type",
                "value": "INT"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7",
              "handleId": "CV",
              "variableType": {
                "name": "CV",
                "class": "output",
                "type": {
                  "definition": "base-type",
                  "value": "INT"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        }
      ],
      "edges": [
        {
          "id": "e_left-rail-rung_Parallel_392fe717-c7f7-45b2-9c8e-088930d9d8a1_CONTACT_8b4cba33-0519-447d-8cf5-15daf3155cc5__left-rail_input",
          "source": "left-rail-rung_Parallel_392fe717-c7f7-45b2-9c8e-088930d9d8a1",
          "target": "CONTACT_8b4cba33-0519-447d-8cf5-15daf3155cc5",
          "sourceHandle": "left-rail",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_8b4cba33-0519-447d-8cf5-15daf3155cc5_PARALLEL_OPEN_34d00ef5-9b9c-4886-87b6-58e702a97d0b__output_input",
          "source": "CONTACT_8b4cba33-0519-447d-8cf5-15daf3155cc5",
          "target": "PARALLEL_OPEN_34d00ef5-9b9c-4886-87b6-58e702a97d0b",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_COIL_e57a29f7-e338-40ab-838c-d09acfde5d8a_PARALLEL_CLOSE_7e3ba027-02c3-4667-be8c-a670a6160fa7__output_input",
          "source": "COIL_e57a29f7-e338-40ab-838c-d09acfde5d8a",
          "target": "PARALLEL_CLOSE_7e3ba027-02c3-4667-be8c-a670a6160fa7",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_CLOSE_7e3ba027-02c3-4667-be8c-a670a6160fa7_right-rail-rung_Parallel_392fe717-c7f7-45b2-9c8e-088930d9d8a1__output-right_right-rail",
          "source": "PARALLEL_CLOSE_7e3ba027-02c3-4667-be8c-a670a6160fa7",
          "target": "right-rail-rung_Parallel_392fe717-c7f7-45b2-9c8e-088930d9d8a1",
          "sourceHandle": "output-right",
          "targetHandle": "right-rail"
        },
        {
          "id": "e_PARALLEL_OPEN_34d00ef5-9b9c-4886-87b6-58e702a97d0b_PARALLEL_OPEN_955a392e-2e7e-4c45-8dca-4d7530ef4d6d__output-down_input-top",
          "source": "PARALLEL_OPEN_34d00ef5-9b9c-4886-87b6-58e702a97d0b",
          "target": "PARALLEL_OPEN_955a392e-2e7e-4c45-8dca-4d7530ef4d6d",
          "sourceHandle": "output-down",
          "targetHandle": "input-top"
        },
        {
          "id": "e_COIL_0e8e36eb-423b-4610-8418-ec6fc7f819d5_PARALLEL_CLOSE_ae2bc724-ad07-4a02-8467-b5cbf3d0abb0__output_input",
          "source": "COIL_0e8e36eb-423b-4610-8418-ec6fc7f819d5",
          "target": "PARALLEL_CLOSE_ae2bc724-ad07-4a02-8467-b5cbf3d0abb0",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_CLOSE_ae2bc724-ad07-4a02-8467-b5cbf3d0abb0_PARALLEL_CLOSE_7e3ba027-02c3-4667-be8c-a670a6160fa7__output-top_input-down",
          "source": "PARALLEL_CLOSE_ae2bc724-ad07-4a02-8467-b5cbf3d0abb0",
          "target": "PARALLEL_CLOSE_7e3ba027-02c3-4667-be8c-a670a6160fa7",
          "sourceHandle": "output-top",
          "targetHandle": "input-down"
        },
        {
          "id": "e_PARALLEL_OPEN_955a392e-2e7e-4c45-8dca-4d7530ef4d6d_PARALLEL_OPEN_0b222bdc-53c5-4dfe-ad0e-6c941d45a212__output-down_input-top",
          "source": "PARALLEL_OPEN_955a392e-2e7e-4c45-8dca-4d7530ef4d6d",
          "target": "PARALLEL_OPEN_0b222bdc-53c5-4dfe-ad0e-6c941d45a212",
          "sourceHandle": "output-down",
          "targetHandle": "input-top"
        },
        {
          "id": "e_COIL_0f49268e-e1e4-4dc0-81d6-040eb2433c25_PARALLEL_CLOSE_40b3b8d7-78de-49c7-b538-0b3a5469b1c5__output_input",
          "source": "COIL_0f49268e-e1e4-4dc0-81d6-040eb2433c25",
          "target": "PARALLEL_CLOSE_40b3b8d7-78de-49c7-b538-0b3a5469b1c5",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_0b222bdc-53c5-4dfe-ad0e-6c941d45a212_COIL_938eb783-70da-4f1d-8bf0-042df8df6f1a__output-down_input",
          "source": "PARALLEL_OPEN_0b222bdc-53c5-4dfe-ad0e-6c941d45a212",
          "target": "COIL_938eb783-70da-4f1d-8bf0-042df8df6f1a",
          "sourceHandle": "output-down",
          "targetHandle": "input"
        },
        {
          "id": "e_COIL_938eb783-70da-4f1d-8bf0-042df8df6f1a_PARALLEL_CLOSE_40b3b8d7-78de-49c7-b538-0b3a5469b1c5__output_input-down",
          "source": "COIL_938eb783-70da-4f1d-8bf0-042df8df6f1a",
          "target": "PARALLEL_CLOSE_40b3b8d7-78de-49c7-b538-0b3a5469b1c5",
          "sourceHandle": "output",
          "targetHandle": "input-down"
        },
        {
          "id": "e_PARALLEL_CLOSE_40b3b8d7-78de-49c7-b538-0b3a5469b1c5_PARALLEL_CLOSE_ae2bc724-ad07-4a02-8467-b5cbf3d0abb0__output-top_input-down",
          "source": "PARALLEL_CLOSE_40b3b8d7-78de-49c7-b538-0b3a5469b1c5",
          "target": "PARALLEL_CLOSE_ae2bc724-ad07-4a02-8467-b5cbf3d0abb0",
          "sourceHandle": "output-top",
          "targetHandle": "input-down"
        },
        {
          "id": "e_BLOCK_272cfd34-6843-45cd-9522-eda23347612d_COIL_e57a29f7-e338-40ab-838c-d09acfde5d8a__Q_input",
          "source": "BLOCK_272cfd34-6843-45cd-9522-eda23347612d",
          "target": "COIL_e57a29f7-e338-40ab-838c-d09acfde5d8a",
          "sourceHandle": "Q",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_34d00ef5-9b9c-4886-87b6-58e702a97d0b_CONTACT_5052cae2-fc40-484e-96b2-a3e66f47c49a__output-right_input",
          "source": "PARALLEL_OPEN_34d00ef5-9b9c-4886-87b6-58e702a97d0b",
          "target": "CONTACT_5052cae2-fc40-484e-96b2-a3e66f47c49a",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_5052cae2-fc40-484e-96b2-a3e66f47c49a_BLOCK_272cfd34-6843-45cd-9522-eda23347612d__output_IN",
          "source": "CONTACT_5052cae2-fc40-484e-96b2-a3e66f47c49a",
          "target": "BLOCK_272cfd34-6843-45cd-9522-eda23347612d",
          "sourceHandle": "output",
          "targetHandle": "IN"
        },
        {
          "id": "e_BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8_COIL_0e8e36eb-423b-4610-8418-ec6fc7f819d5__Q_input",
          "source": "BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8",
          "target": "COIL_0e8e36eb-423b-4610-8418-ec6fc7f819d5",
          "sourceHandle": "Q",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_955a392e-2e7e-4c45-8dca-4d7530ef4d6d_CONTACT_ec714b4b-7084-41ec-995f-092c963a2bed__output-right_input",
          "source": "PARALLEL_OPEN_955a392e-2e7e-4c45-8dca-4d7530ef4d6d",
          "target": "CONTACT_ec714b4b-7084-41ec-995f-092c963a2bed",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_ec714b4b-7084-41ec-995f-092c963a2bed_BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8__output_IN",
          "source": "CONTACT_ec714b4b-7084-41ec-995f-092c963a2bed",
          "target": "BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8",
          "sourceHandle": "output",
          "targetHandle": "IN"
        },
        {
          "id": "e_BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7_COIL_0f49268e-e1e4-4dc0-81d6-040eb2433c25__Q_input",
          "source": "BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7",
          "target": "COIL_0f49268e-e1e4-4dc0-81d6-040eb2433c25",
          "sourceHandle": "Q",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_0b222bdc-53c5-4dfe-ad0e-6c941d45a212_CONTACT_0b750ebd-4f17-41e1-820b-3c0a08bfb7a4__output-right_input",
          "source": "PARALLEL_OPEN_0b222bdc-53c5-4dfe-ad0e-6c941d45a212",
          "target": "CONTACT_0b750ebd-4f17-41e1-820b-3c0a08bfb7a4",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_0b750ebd-4f17-41e1-820b-3c0a08bfb7a4_BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7__output_CU",
          "source": "CONTACT_0b750ebd-4f17-41e1-820b-3c0a08bfb7a4",
          "target": "BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7",
          "sourceHandle": "output",
          "targetHandle": "CU"
        },
        {
          "id": "e_VARIABLE_64355984-ade5-41c5-bdc4-cb6b48e25ac6_BLOCK_272cfd34-6843-45cd-9522-eda23347612d__output_PT",
          "source": "VARIABLE_64355984-ade5-41c5-bdc4-cb6b48e25ac6",
          "target": "BLOCK_272cfd34-6843-45cd-9522-eda23347612d",
          "sourceHandle": "output",
          "targetHandle": "PT"
        },
        {
          "id": "e_BLOCK_272cfd34-6843-45cd-9522-eda23347612d_VARIABLE_8f975ff1-7b7b-49bf-8a0d-76ca425dd729__ET_input",
          "source": "BLOCK_272cfd34-6843-45cd-9522-eda23347612d",
          "target": "VARIABLE_8f975ff1-7b7b-49bf-8a0d-76ca425dd729",
          "sourceHandle": "ET",
          "targetHandle": "input"
        },
        {
          "id": "e_VARIABLE_0f2f55ea-6d3a-44f0-85d6-c4cc8012399b_BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8__output_PT",
          "source": "VARIABLE_0f2f55ea-6d3a-44f0-85d6-c4cc8012399b",
          "target": "BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8",
          "sourceHandle": "output",
          "targetHandle": "PT"
        },
        {
          "id": "e_BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8_VARIABLE_52238cd0-cb2d-43e3-87d7-0014f2017bd9__ET_input",
          "source": "BLOCK_1808fdf6-000b-4a84-b0ae-8a18971952a8",
          "target": "VARIABLE_52238cd0-cb2d-43e3-87d7-0014f2017bd9",
          "sourceHandle": "ET",
          "targetHandle": "input"
        },
        {
          "id": "e_VARIABLE_7394396b-01a4-403a-973b-97b686ed0632_BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7__output_R",
          "source": "VARIABLE_7394396b-01a4-403a-973b-97b686ed0632",
          "target": "BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7",
          "sourceHandle": "output",
          "targetHandle": "R"
        },
        {
          "id": "e_VARIABLE_1489c0b9-3fab-428f-ad80-74d492902c97_BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7__output_PV",
          "source": "VARIABLE_1489c0b9-3fab-428f-ad80-74d492902c97",
          "target": "BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7",
          "sourceHandle": "output",
          "targetHandle": "PV"
        },
        {
          "id": "e_BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7_VARIABLE_91af9bf4-1629-4238-b83b-4e6845e6e3ee__CV_input",
          "source": "BLOCK_5271aa7d-1cea-4d1c-b66d-45227588c8f7",
          "target": "VARIABLE_91af9bf4-1629-4238-b83b-4e6845e6e3ee",
          "sourceHandle": "CV",
          "targetHandle": "input"
        }
      ],
      "selectedNodes": []
    },
    {
      "id": "rung_Parallel_5deaabba-ede6-4ae7-b61b-5364f17a564b",
      "comment": "H09 blocks-feed-across-parallel",
      "defaultBounds": [
        300,
        100
      ],
      "reactFlowViewport": [
        967,
        278
      ],
      "nodes": [
        {
          "id": "left-rail-rung_Parallel_5deaabba-ede6-4ae7-b61b-5364f17a564b",
          "type": "powerRail",
          "position": {
            "x": 0,
            "y": 30
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 3,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "left-rail",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "right": -3
                }
              },
              {
                "glbPosition": {
                  "x": 3,
                  "y": 130
                },
                "relPosition": {
                  "x": 3,
                  "y": 100
                },
                "id": "branch_BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e_IN2",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 100,
                  "right": -3
                }
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 3,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "left-rail",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "right": -3
                }
              },
              {
                "glbPosition": {
                  "x": 3,
                  "y": 130
                },
                "relPosition": {
                  "x": 3,
                  "y": 100
                },
                "id": "branch_BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e_IN2",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 100,
                  "right": -3
                }
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 3,
                "y": 50
              },
              "relPosition": {
                "x": 3,
                "y": 20
              },
              "id": "left-rail",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 20,
                "right": -3
              }
            },
            "numericId": "1066887",
            "variant": "left",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 3,
          "height": 40,
          "measured": {
            "width": 3,
            "height": 40
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_OPEN_c93808cd-fd0e-44cc-a37a-5c7315afdca7",
          "type": "parallel",
          "position": {
            "x": 23,
            "y": 49
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 23,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 23,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 27,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 23,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 27,
                "y": 50
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "3395065",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 27,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "input-top",
              "position": "top",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 27,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "output-down",
              "position": "bottom",
              "type": "source",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelCloseReference": "PARALLEL_CLOSE_50487aa9-5d77-4e29-b06d-ac19856df7dc",
            "type": "open",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_6ad82ca8-b0f3-4e77-8de8-39ddbca16227",
          "type": "contact",
          "position": {
            "x": 72,
            "y": 38
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 72,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 96,
                  "y": 50
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 72,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 96,
                  "y": 50
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 72,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 96,
                "y": 50
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "8178785",
            "variable": {
              "id": "ebbbee38-483b-40ad-87e7-d2b240ffe179",
              "name": "h09_a",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40",
          "type": "block",
          "position": {
            "x": 261,
            "y": 14
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 261,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 50
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 90
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 261,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 327,
                  "y": 50
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 90
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 261,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 36
              },
              "id": "IN",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 36,
                "left": 0
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 327,
                "y": 50
              },
              "relPosition": {
                "x": 66,
                "y": 36
              },
              "id": "Q",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 36,
                "right": 0
              }
            },
            "numericId": "3533156",
            "variant": {
              "name": "TON",
              "type": "function-block",
              "variables": [
                {
                  "name": "IN",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "PT",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                },
                {
                  "name": "Q",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "ET",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                }
              ],
              "documentation": "The on-delay timer can be used to delay setting an output true, for fixed period after an input becomes true.",
              "extensible": false
            },
            "variable": {
              "id": "e48e5814-5f12-4edd-881e-104086abd163",
              "name": "TON2",
              "type": {
                "definition": "derived",
                "value": "TON"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "executionControl": false,
            "lockExecutionControl": false,
            "connectedVariables": [
              {
                "handleId": "PT",
                "type": "input",
                "variable": {
                  "name": "T#1s"
                }
              }
            ],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 66,
          "height": 100,
          "measured": {
            "width": 66,
            "height": 100
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_db5baad0-952c-4a4a-83de-b2df15532ecc",
          "type": "contact",
          "position": {
            "x": 72,
            "y": 182
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 72,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 96,
                  "y": 194
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 72,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 96,
                  "y": 194
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 72,
                "y": 194
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 96,
                "y": 194
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "9779015",
            "variable": {
              "id": "d0b2840b-bcfe-44c0-8232-356bccda702e",
              "name": "h09_b",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b",
          "type": "block",
          "position": {
            "x": 261,
            "y": 158
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 261,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 194
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 234
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 261,
                  "y": 194
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 261,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "PT",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 327,
                  "y": 194
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "Q",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 327,
                  "y": 234
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "ET",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 261,
                "y": 194
              },
              "relPosition": {
                "x": 0,
                "y": 36
              },
              "id": "IN",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 36,
                "left": 0
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 327,
                "y": 194
              },
              "relPosition": {
                "x": 66,
                "y": 36
              },
              "id": "Q",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 36,
                "right": 0
              }
            },
            "numericId": "4314006",
            "variant": {
              "name": "TOF",
              "type": "function-block",
              "variables": [
                {
                  "name": "IN",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "PT",
                  "class": "input",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                },
                {
                  "name": "Q",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "ET",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "TIME"
                  }
                }
              ],
              "documentation": "The off-delay timer can be used to delay setting an output false, for fixed period after input goes false.",
              "extensible": false
            },
            "variable": {
              "id": "e4a05d77-2182-42ab-ad5c-2b613119457d",
              "name": "TOF1",
              "type": {
                "definition": "derived",
                "value": "TOF"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "executionControl": false,
            "lockExecutionControl": false,
            "connectedVariables": [
              {
                "handleId": "PT",
                "type": "input",
                "variable": {
                  "name": "T#2s"
                }
              }
            ],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 66,
          "height": 100,
          "measured": {
            "width": 66,
            "height": 100
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_CLOSE_50487aa9-5d77-4e29-b06d-ac19856df7dc",
          "type": "parallel",
          "position": {
            "x": 447,
            "y": 49
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 447,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 447,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 50
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 447,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 451,
                "y": 50
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "8320296",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 451,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "input-down",
              "position": "bottom",
              "type": "target",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 451,
                "y": 50
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "output-top",
              "position": "top",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOpenReference": "PARALLEL_OPEN_c93808cd-fd0e-44cc-a37a-5c7315afdca7",
            "type": "close",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e",
          "type": "block",
          "position": {
            "x": 571,
            "y": 14
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 571,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN1",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 571,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "IN2",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 661,
                  "y": 50
                },
                "relPosition": {
                  "x": 90,
                  "y": 36
                },
                "id": "OUT",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 571,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 36
                },
                "id": "IN1",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 571,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "IN2",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 661,
                  "y": 50
                },
                "relPosition": {
                  "x": 90,
                  "y": 36
                },
                "id": "OUT",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 36,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 571,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 36
              },
              "id": "IN1",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 36,
                "left": 0
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 661,
                "y": 50
              },
              "relPosition": {
                "x": 90,
                "y": 36
              },
              "id": "OUT",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 36,
                "right": 0
              }
            },
            "numericId": "5437823",
            "variant": {
              "name": "AND",
              "type": "function",
              "variables": [
                {
                  "name": "OUT",
                  "class": "output",
                  "type": {
                    "definition": "generic-type",
                    "value": "ANY_BIT"
                  }
                },
                {
                  "name": "IN1",
                  "class": "input",
                  "type": {
                    "definition": "generic-type",
                    "value": "ANY_BIT"
                  }
                },
                {
                  "name": "IN2",
                  "class": "input",
                  "type": {
                    "definition": "generic-type",
                    "value": "ANY_BIT"
                  }
                }
              ],
              "documentation": "",
              "extensible": true
            },
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "executionControl": false,
            "lockExecutionControl": false,
            "connectedVariables": [],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 90,
          "height": 140,
          "measured": {
            "width": 90,
            "height": 140
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "COIL_57830053-b71c-4ea4-95c7-de52ef849ec8",
          "type": "coil",
          "position": {
            "x": 826,
            "y": 38
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 826,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 854,
                  "y": 50
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 826,
                  "y": 50
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 854,
                  "y": 50
                },
                "relPosition": {
                  "x": 28,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 826,
                "y": 50
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 854,
                "y": 50
              },
              "relPosition": {
                "x": 28,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "5009225",
            "variable": {
              "id": "d1d6d2dc-db2c-49f5-abfa-45bc58fac9d6",
              "name": "h09_out",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 28,
          "height": 24,
          "measured": {
            "width": 28,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_3c630000-962d-4a18-8e9f-3687265bddc2",
          "type": "contact",
          "position": {
            "x": 378,
            "y": 118
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 378,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 402,
                  "y": 130
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 378,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 402,
                  "y": 130
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 378,
                "y": 130
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 402,
                "y": 130
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "5622174",
            "variable": {
              "id": "6c25cff8-5138-4281-9d2f-baba20619ede",
              "name": "h09_c",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true,
            "branchContext": {
              "blockId": "BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e",
              "handleId": "IN2",
              "direction": "input"
            }
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_OPEN_332ba396-aaa2-4d89-8d69-27f86d0454f4",
          "type": "parallel",
          "position": {
            "x": 329,
            "y": 129
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 329,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 329,
                  "y": 130
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              },
              {
                "glbPosition": {
                  "x": 333,
                  "y": 130
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 333,
                  "y": 130
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 329,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 329,
                  "y": 130
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "input-top",
                "position": "top",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 333,
                  "y": 130
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 333,
                  "y": 130
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "output-down",
                "position": "bottom",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 329,
                "y": 130
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 333,
                "y": 130
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "4882931",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 329,
                "y": 130
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "input-top",
              "position": "top",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 333,
                "y": 130
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "output-down",
              "position": "bottom",
              "type": "source",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelCloseReference": "PARALLEL_CLOSE_365bf737-34d0-4276-9a17-e47bea309212",
            "type": "open",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false,
            "branchContext": {
              "blockId": "BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e",
              "handleId": "IN2",
              "direction": "input"
            }
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "CONTACT_f0adff56-6f3e-4da9-b629-5e083c00d823",
          "type": "contact",
          "position": {
            "x": 378,
            "y": 222
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 378,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              },
              {
                "glbPosition": {
                  "x": 402,
                  "y": 234
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "variant": "default",
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 378,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 12
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "style": {
                  "left": -3
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 402,
                  "y": 234
                },
                "relPosition": {
                  "x": 24,
                  "y": 12
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "style": {
                  "right": -3
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 378,
                "y": 234
              },
              "relPosition": {
                "x": 0,
                "y": 12
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "style": {
                "left": -3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 402,
                "y": 234
              },
              "relPosition": {
                "x": 24,
                "y": 12
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "style": {
                "right": -3
              }
            },
            "numericId": "1853498",
            "variable": {
              "id": "a7d864ab-7345-41a1-8616-bc7230d9a780",
              "name": "h09_d",
              "type": {
                "definition": "base-type",
                "value": "BOOL"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "draggable": true,
            "selectable": true,
            "deletable": true,
            "branchContext": {
              "blockId": "BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e",
              "handleId": "IN2",
              "direction": "input"
            }
          },
          "width": 24,
          "height": 24,
          "measured": {
            "width": 24,
            "height": 24
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "PARALLEL_CLOSE_365bf737-34d0-4276-9a17-e47bea309212",
          "type": "parallel",
          "position": {
            "x": 447,
            "y": 129
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 447,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 447,
                  "y": 130
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 130
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 130
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 447,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 1
                },
                "id": "input",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "left": 3
                }
              },
              {
                "glbPosition": {
                  "x": 447,
                  "y": 130
                },
                "relPosition": {
                  "x": 2,
                  "y": 2
                },
                "id": "input-down",
                "position": "bottom",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "bottom": 1
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 451,
                  "y": 130
                },
                "relPosition": {
                  "x": 4,
                  "y": 1
                },
                "id": "output-right",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "visibility": "hidden",
                  "right": 3
                }
              },
              {
                "glbPosition": {
                  "x": 451,
                  "y": 130
                },
                "relPosition": {
                  "x": 2,
                  "y": 0
                },
                "id": "output-top",
                "position": "top",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 1
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 447,
                "y": 130
              },
              "relPosition": {
                "x": 0,
                "y": 1
              },
              "id": "input",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "left": 3
              }
            },
            "outputConnector": {
              "glbPosition": {
                "x": 451,
                "y": 130
              },
              "relPosition": {
                "x": 4,
                "y": 1
              },
              "id": "output-right",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "visibility": "hidden",
                "right": 3
              }
            },
            "numericId": "5169074",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 447,
                "y": 130
              },
              "relPosition": {
                "x": 2,
                "y": 2
              },
              "id": "input-down",
              "position": "bottom",
              "type": "target",
              "isConnectable": false,
              "style": {
                "bottom": 1
              }
            },
            "parallelOutputConnector": {
              "glbPosition": {
                "x": 451,
                "y": 130
              },
              "relPosition": {
                "x": 2,
                "y": 0
              },
              "id": "output-top",
              "position": "top",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 1
              }
            },
            "parallelOpenReference": "PARALLEL_OPEN_332ba396-aaa2-4d89-8d69-27f86d0454f4",
            "type": "close",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false,
            "branchContext": {
              "blockId": "BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e",
              "handleId": "IN2",
              "direction": "input"
            }
          },
          "width": 4,
          "height": 2,
          "measured": {
            "width": 4,
            "height": 2
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "right-rail-rung_Parallel_5deaabba-ede6-4ae7-b61b-5364f17a564b",
          "type": "powerRail",
          "position": {
            "x": 964,
            "y": 30
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 297,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "right-rail",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "left": -3
                },
                "x": 964
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 297,
                  "y": 50
                },
                "relPosition": {
                  "x": 3,
                  "y": 20
                },
                "id": "right-rail",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 20,
                  "left": -3
                }
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 297,
                "y": 50
              },
              "relPosition": {
                "x": 3,
                "y": 20
              },
              "id": "right-rail",
              "position": "left",
              "type": "target",
              "isConnectable": false,
              "style": {
                "top": 20,
                "left": -3
              }
            },
            "numericId": "6774914",
            "variant": "right",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false
          },
          "width": 3,
          "height": 40,
          "measured": {
            "width": 3,
            "height": 40
          },
          "draggable": false,
          "selectable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_57d1a047-0346-41cb-91a4-f46c3c94d150",
          "type": "variable",
          "position": {
            "x": 151,
            "y": 74
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 311,
                "y": 90
              },
              "relPosition": {
                "x": 80,
                "y": 16
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source"
            },
            "numericId": "1492958",
            "variable": {
              "name": "T#1s"
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40",
              "handleId": "PT",
              "variableType": {
                "name": "PT",
                "class": "input",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_7e82789d-ef27-4d0d-badd-1783126069b4",
          "type": "variable",
          "position": {
            "x": 357,
            "y": 74
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 357,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 357,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 357,
                "y": 90
              },
              "relPosition": {
                "x": 0,
                "y": 16
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target"
            },
            "numericId": "540675",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40",
              "handleId": "ET",
              "variableType": {
                "name": "ET",
                "class": "output",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_44b6bf45-ee55-4e74-9698-a32e4ea75e1d",
          "type": "variable",
          "position": {
            "x": 151,
            "y": 218
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 234
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 311,
                  "y": 234
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                },
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source"
              }
            ],
            "outputConnector": {
              "glbPosition": {
                "x": 311,
                "y": 234
              },
              "relPosition": {
                "x": 80,
                "y": 16
              },
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source"
            },
            "numericId": "4394860",
            "variable": {
              "name": "T#2s"
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b",
              "handleId": "PT",
              "variableType": {
                "name": "PT",
                "class": "input",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        },
        {
          "id": "VARIABLE_906c3455-0217-4fcd-abaf-b4b76d53718d",
          "type": "variable",
          "position": {
            "x": 357,
            "y": 218
          },
          "width": 80,
          "height": 32,
          "measured": {
            "width": 80,
            "height": 32
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 357,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 357,
                  "y": 234
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                },
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target"
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "glbPosition": {
                "x": 357,
                "y": 234
              },
              "relPosition": {
                "x": 0,
                "y": 16
              },
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target"
            },
            "numericId": "1044832",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b",
              "handleId": "ET",
              "variableType": {
                "name": "ET",
                "class": "output",
                "type": {
                  "definition": "base-type",
                  "value": "TIME"
                }
              }
            },
            "draggable": false,
            "selectable": true,
            "deletable": false
          },
          "deletable": false,
          "selectable": true,
          "draggable": false,
          "selected": false,
          "dragging": false
        }
      ],
      "edges": [
        {
          "id": "e_BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e_COIL_57830053-b71c-4ea4-95c7-de52ef849ec8__OUT_input",
          "source": "BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e",
          "target": "COIL_57830053-b71c-4ea4-95c7-de52ef849ec8",
          "sourceHandle": "OUT",
          "targetHandle": "input"
        },
        {
          "id": "e_COIL_57830053-b71c-4ea4-95c7-de52ef849ec8_right-rail-rung_Parallel_5deaabba-ede6-4ae7-b61b-5364f17a564b__output_right-rail",
          "source": "COIL_57830053-b71c-4ea4-95c7-de52ef849ec8",
          "target": "right-rail-rung_Parallel_5deaabba-ede6-4ae7-b61b-5364f17a564b",
          "sourceHandle": "output",
          "targetHandle": "right-rail"
        },
        {
          "id": "e_left-rail-rung_Parallel_5deaabba-ede6-4ae7-b61b-5364f17a564b_PARALLEL_OPEN_c93808cd-fd0e-44cc-a37a-5c7315afdca7__left-rail_input",
          "source": "left-rail-rung_Parallel_5deaabba-ede6-4ae7-b61b-5364f17a564b",
          "target": "PARALLEL_OPEN_c93808cd-fd0e-44cc-a37a-5c7315afdca7",
          "sourceHandle": "left-rail",
          "targetHandle": "input"
        },
        {
          "id": "e_BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40_PARALLEL_CLOSE_50487aa9-5d77-4e29-b06d-ac19856df7dc__Q_input",
          "source": "BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40",
          "target": "PARALLEL_CLOSE_50487aa9-5d77-4e29-b06d-ac19856df7dc",
          "sourceHandle": "Q",
          "targetHandle": "input"
        },
        {
          "id": "e_BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b_PARALLEL_CLOSE_50487aa9-5d77-4e29-b06d-ac19856df7dc__Q_input-down",
          "source": "BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b",
          "target": "PARALLEL_CLOSE_50487aa9-5d77-4e29-b06d-ac19856df7dc",
          "sourceHandle": "Q",
          "targetHandle": "input-down"
        },
        {
          "id": "e_PARALLEL_CLOSE_50487aa9-5d77-4e29-b06d-ac19856df7dc_BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e__output-right_IN1",
          "source": "PARALLEL_CLOSE_50487aa9-5d77-4e29-b06d-ac19856df7dc",
          "target": "BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e",
          "sourceHandle": "output-right",
          "targetHandle": "IN1"
        },
        {
          "id": "e_PARALLEL_OPEN_c93808cd-fd0e-44cc-a37a-5c7315afdca7_CONTACT_6ad82ca8-b0f3-4e77-8de8-39ddbca16227__output-right_input",
          "source": "PARALLEL_OPEN_c93808cd-fd0e-44cc-a37a-5c7315afdca7",
          "target": "CONTACT_6ad82ca8-b0f3-4e77-8de8-39ddbca16227",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_6ad82ca8-b0f3-4e77-8de8-39ddbca16227_BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40__output_IN",
          "source": "CONTACT_6ad82ca8-b0f3-4e77-8de8-39ddbca16227",
          "target": "BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40",
          "sourceHandle": "output",
          "targetHandle": "IN"
        },
        {
          "id": "e_PARALLEL_OPEN_c93808cd-fd0e-44cc-a37a-5c7315afdca7_CONTACT_db5baad0-952c-4a4a-83de-b2df15532ecc__output-down_input",
          "source": "PARALLEL_OPEN_c93808cd-fd0e-44cc-a37a-5c7315afdca7",
          "target": "CONTACT_db5baad0-952c-4a4a-83de-b2df15532ecc",
          "sourceHandle": "output-down",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_db5baad0-952c-4a4a-83de-b2df15532ecc_BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b__output_IN",
          "source": "CONTACT_db5baad0-952c-4a4a-83de-b2df15532ecc",
          "target": "BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b",
          "sourceHandle": "output",
          "targetHandle": "IN"
        },
        {
          "id": "e_left-rail-rung_Parallel_5deaabba-ede6-4ae7-b61b-5364f17a564b_PARALLEL_OPEN_332ba396-aaa2-4d89-8d69-27f86d0454f4__branch_BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e_IN2_input",
          "source": "left-rail-rung_Parallel_5deaabba-ede6-4ae7-b61b-5364f17a564b",
          "target": "PARALLEL_OPEN_332ba396-aaa2-4d89-8d69-27f86d0454f4",
          "sourceHandle": "branch_BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e_IN2",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_332ba396-aaa2-4d89-8d69-27f86d0454f4_CONTACT_3c630000-962d-4a18-8e9f-3687265bddc2__output-right_input",
          "source": "PARALLEL_OPEN_332ba396-aaa2-4d89-8d69-27f86d0454f4",
          "target": "CONTACT_3c630000-962d-4a18-8e9f-3687265bddc2",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_3c630000-962d-4a18-8e9f-3687265bddc2_PARALLEL_CLOSE_365bf737-34d0-4276-9a17-e47bea309212__output_input",
          "source": "CONTACT_3c630000-962d-4a18-8e9f-3687265bddc2",
          "target": "PARALLEL_CLOSE_365bf737-34d0-4276-9a17-e47bea309212",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_332ba396-aaa2-4d89-8d69-27f86d0454f4_CONTACT_f0adff56-6f3e-4da9-b629-5e083c00d823__output-down_input",
          "source": "PARALLEL_OPEN_332ba396-aaa2-4d89-8d69-27f86d0454f4",
          "target": "CONTACT_f0adff56-6f3e-4da9-b629-5e083c00d823",
          "sourceHandle": "output-down",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_f0adff56-6f3e-4da9-b629-5e083c00d823_PARALLEL_CLOSE_365bf737-34d0-4276-9a17-e47bea309212__output_input-down",
          "source": "CONTACT_f0adff56-6f3e-4da9-b629-5e083c00d823",
          "target": "PARALLEL_CLOSE_365bf737-34d0-4276-9a17-e47bea309212",
          "sourceHandle": "output",
          "targetHandle": "input-down"
        },
        {
          "id": "e_PARALLEL_CLOSE_365bf737-34d0-4276-9a17-e47bea309212_BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e__output-right_IN2",
          "source": "PARALLEL_CLOSE_365bf737-34d0-4276-9a17-e47bea309212",
          "target": "BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e",
          "sourceHandle": "output-right",
          "targetHandle": "IN2"
        },
        {
          "id": "e_VARIABLE_57d1a047-0346-41cb-91a4-f46c3c94d150_BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40__output_PT",
          "source": "VARIABLE_57d1a047-0346-41cb-91a4-f46c3c94d150",
          "target": "BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40",
          "sourceHandle": "output",
          "targetHandle": "PT"
        },
        {
          "id": "e_BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40_VARIABLE_7e82789d-ef27-4d0d-badd-1783126069b4__ET_input",
          "source": "BLOCK_55b812c8-d34f-4e90-9141-d70ee4e18f40",
          "target": "VARIABLE_7e82789d-ef27-4d0d-badd-1783126069b4",
          "sourceHandle": "ET",
          "targetHandle": "input"
        },
        {
          "id": "e_VARIABLE_44b6bf45-ee55-4e74-9698-a32e4ea75e1d_BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b__output_PT",
          "source": "VARIABLE_44b6bf45-ee55-4e74-9698-a32e4ea75e1d",
          "target": "BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b",
          "sourceHandle": "output",
          "targetHandle": "PT"
        },
        {
          "id": "e_BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b_VARIABLE_906c3455-0217-4fcd-abaf-b4b76d53718d__ET_input",
          "source": "BLOCK_9e6931b6-9687-47db-8a78-083a3e98401b",
          "target": "VARIABLE_906c3455-0217-4fcd-abaf-b4b76d53718d",
          "sourceHandle": "ET",
          "targetHandle": "input"
        }
      ],
      "selectedNodes": [],
      "handleBranches": [
        {
          "blockId": "BLOCK_2dcb4980-f936-44cf-a5e8-2e4052ecea4e",
          "handleId": "IN2",
          "direction": "input",
          "nodeIds": [
            "PARALLEL_OPEN_332ba396-aaa2-4d89-8d69-27f86d0454f4",
            "CONTACT_3c630000-962d-4a18-8e9f-3687265bddc2",
            "PARALLEL_CLOSE_365bf737-34d0-4276-9a17-e47bea309212"
          ]
        }
      ]
    }
  ]
}
END_PROGRAM