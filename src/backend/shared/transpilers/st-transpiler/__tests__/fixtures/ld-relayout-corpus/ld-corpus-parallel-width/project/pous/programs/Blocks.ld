PROGRAM Blocks
  VAR
    TON0 : TON;
    w06_y : BOOL;
    w06_b : BOOL;
    w06_a : BOOL;
    w07_c : BOOL;
    CTU0 : CTU;
    w07_y : BOOL;
    w07_i : BOOL;
    w07_k : BOOL;
    w07_j : BOOL;
    w08_c : BOOL;
    CTUD0 : CTUD;
    w08_y : BOOL;
    w08_i : BOOL;
    w08_k : BOOL;
    w08_l : BOOL;
    w08_j : BOOL;
  END_VAR

{
  "name": "Blocks",
  "rungs": [
    {
      "id": "rung_Blocks_8f9c8d68-9bc1-4cf9-8fd8-d33d330b33fa",
      "comment": "W06 block-branch-vs-contact-branch",
      "defaultBounds": [
        300,
        100
      ],
      "reactFlowViewport": [
        637,
        226
      ],
      "nodes": [
        {
          "id": "left-rail-rung_Blocks_8f9c8d68-9bc1-4cf9-8fd8-d33d330b33fa",
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
            "numericId": "7715933",
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
          "id": "PARALLEL_OPEN_ef03ea9d-0cc3-4e40-9a96-81b56574eb0c",
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
            "numericId": "549006",
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
            "parallelCloseReference": "PARALLEL_CLOSE_9be569a0-b151-4803-99c4-9d44e84e61df",
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
          "id": "CONTACT_fba327f0-7851-476d-8454-b4b5debcc0bd",
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
            "numericId": "4559821",
            "variable": {
              "id": "de3d8127-a40c-4a5e-9fb7-166149517a99",
              "name": "w06_a",
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
          "id": "BLOCK_f5367001-f4ab-4252-b39e-804989068fcc",
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
            "numericId": "2798937",
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
              "id": "88d7cc76-5dbe-48d3-94b1-10eee0705e99",
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
          "id": "CONTACT_164c5a61-aebf-493a-8e1c-a1272473befe",
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
            "numericId": "7355203",
            "variable": {
              "id": "f9fa158e-61da-4d30-8bd6-65b0622c0888",
              "name": "w06_b",
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
          "id": "PARALLEL_CLOSE_9be569a0-b151-4803-99c4-9d44e84e61df",
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
            "numericId": "811863",
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
            "parallelOpenReference": "PARALLEL_OPEN_ef03ea9d-0cc3-4e40-9a96-81b56574eb0c",
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
          "id": "COIL_62bffcb4-cb37-41a5-806d-0ccc71d239e6",
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
            "numericId": "2060209",
            "variable": {
              "id": "38c314ac-5173-4eb7-8817-4106f0a35399",
              "name": "w06_y",
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
          "id": "right-rail-rung_Blocks_8f9c8d68-9bc1-4cf9-8fd8-d33d330b33fa",
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
            "numericId": "8993324",
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
          "id": "VARIABLE_cffac8af-c114-45c2-89b2-4e0f909c1f34",
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
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 311,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 311,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "outputConnector": {
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "glbPosition": {
                "x": 311,
                "y": 90
              },
              "relPosition": {
                "x": 80,
                "y": 16
              }
            },
            "numericId": "223198",
            "variable": {
              "name": "T#1s"
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_f5367001-f4ab-4252-b39e-804989068fcc",
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
          "id": "VARIABLE_5be93cfb-35b7-477b-80f4-40d7ae182e6f",
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
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "glbPosition": {
                  "x": 357,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                }
              }
            ],
            "inputHandles": [
              {
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "glbPosition": {
                  "x": 357,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                }
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "glbPosition": {
                "x": 357,
                "y": 90
              },
              "relPosition": {
                "x": 0,
                "y": 16
              }
            },
            "numericId": "333323",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_f5367001-f4ab-4252-b39e-804989068fcc",
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
          "id": "e_COIL_62bffcb4-cb37-41a5-806d-0ccc71d239e6_right-rail-rung_Blocks_8f9c8d68-9bc1-4cf9-8fd8-d33d330b33fa__output_right-rail",
          "source": "COIL_62bffcb4-cb37-41a5-806d-0ccc71d239e6",
          "target": "right-rail-rung_Blocks_8f9c8d68-9bc1-4cf9-8fd8-d33d330b33fa",
          "sourceHandle": "output",
          "targetHandle": "right-rail"
        },
        {
          "id": "e_left-rail-rung_Blocks_8f9c8d68-9bc1-4cf9-8fd8-d33d330b33fa_PARALLEL_OPEN_ef03ea9d-0cc3-4e40-9a96-81b56574eb0c__left-rail_input",
          "source": "left-rail-rung_Blocks_8f9c8d68-9bc1-4cf9-8fd8-d33d330b33fa",
          "target": "PARALLEL_OPEN_ef03ea9d-0cc3-4e40-9a96-81b56574eb0c",
          "sourceHandle": "left-rail",
          "targetHandle": "input"
        },
        {
          "id": "e_BLOCK_f5367001-f4ab-4252-b39e-804989068fcc_PARALLEL_CLOSE_9be569a0-b151-4803-99c4-9d44e84e61df__Q_input",
          "source": "BLOCK_f5367001-f4ab-4252-b39e-804989068fcc",
          "target": "PARALLEL_CLOSE_9be569a0-b151-4803-99c4-9d44e84e61df",
          "sourceHandle": "Q",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_ef03ea9d-0cc3-4e40-9a96-81b56574eb0c_CONTACT_164c5a61-aebf-493a-8e1c-a1272473befe__output-down_input",
          "source": "PARALLEL_OPEN_ef03ea9d-0cc3-4e40-9a96-81b56574eb0c",
          "target": "CONTACT_164c5a61-aebf-493a-8e1c-a1272473befe",
          "sourceHandle": "output-down",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_164c5a61-aebf-493a-8e1c-a1272473befe_PARALLEL_CLOSE_9be569a0-b151-4803-99c4-9d44e84e61df__output_input-down",
          "source": "CONTACT_164c5a61-aebf-493a-8e1c-a1272473befe",
          "target": "PARALLEL_CLOSE_9be569a0-b151-4803-99c4-9d44e84e61df",
          "sourceHandle": "output",
          "targetHandle": "input-down"
        },
        {
          "id": "e_PARALLEL_CLOSE_9be569a0-b151-4803-99c4-9d44e84e61df_COIL_62bffcb4-cb37-41a5-806d-0ccc71d239e6__output-right_input",
          "source": "PARALLEL_CLOSE_9be569a0-b151-4803-99c4-9d44e84e61df",
          "target": "COIL_62bffcb4-cb37-41a5-806d-0ccc71d239e6",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_ef03ea9d-0cc3-4e40-9a96-81b56574eb0c_CONTACT_fba327f0-7851-476d-8454-b4b5debcc0bd__output-right_input",
          "source": "PARALLEL_OPEN_ef03ea9d-0cc3-4e40-9a96-81b56574eb0c",
          "target": "CONTACT_fba327f0-7851-476d-8454-b4b5debcc0bd",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_fba327f0-7851-476d-8454-b4b5debcc0bd_BLOCK_f5367001-f4ab-4252-b39e-804989068fcc__output_IN",
          "source": "CONTACT_fba327f0-7851-476d-8454-b4b5debcc0bd",
          "target": "BLOCK_f5367001-f4ab-4252-b39e-804989068fcc",
          "sourceHandle": "output",
          "targetHandle": "IN"
        },
        {
          "id": "e_VARIABLE_cffac8af-c114-45c2-89b2-4e0f909c1f34_BLOCK_f5367001-f4ab-4252-b39e-804989068fcc__output_PT",
          "source": "VARIABLE_cffac8af-c114-45c2-89b2-4e0f909c1f34",
          "target": "BLOCK_f5367001-f4ab-4252-b39e-804989068fcc",
          "sourceHandle": "output",
          "targetHandle": "PT"
        },
        {
          "id": "e_BLOCK_f5367001-f4ab-4252-b39e-804989068fcc_VARIABLE_5be93cfb-35b7-477b-80f4-40d7ae182e6f__ET_input",
          "source": "BLOCK_f5367001-f4ab-4252-b39e-804989068fcc",
          "target": "VARIABLE_5be93cfb-35b7-477b-80f4-40d7ae182e6f",
          "sourceHandle": "ET",
          "targetHandle": "input"
        }
      ],
      "selectedNodes": []
    },
    {
      "id": "rung_Blocks_635be45f-5602-4177-b30c-ef155242af49",
      "comment": "W07 pin-network-unequal",
      "defaultBounds": [
        300,
        100
      ],
      "reactFlowViewport": [
        796,
        322
      ],
      "nodes": [
        {
          "id": "left-rail-rung_Blocks_635be45f-5602-4177-b30c-ef155242af49",
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
                "id": "branch_BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79_R",
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
                "id": "branch_BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79_R",
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
            "numericId": "2740290",
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
          "id": "CONTACT_cd537fba-fd59-4970-8cd3-784ff23d49a7",
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
            "numericId": "3651905",
            "variable": {
              "id": "9f3e7583-14c9-4aef-b185-4b94f8b368a6",
              "name": "w07_c",
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
          "id": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
          "type": "block",
          "position": {
            "x": 424,
            "y": 14
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 424,
                  "y": 50
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
                  "x": 424,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "R",
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
                  "x": 424,
                  "y": 278
                },
                "relPosition": {
                  "x": 0,
                  "y": 264
                },
                "id": "PV",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 264,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 490,
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
                  "x": 490,
                  "y": 130
                },
                "relPosition": {
                  "x": 66,
                  "y": 116
                },
                "id": "CV",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 424,
                  "y": 50
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
                  "x": 424,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "R",
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
                  "x": 424,
                  "y": 278
                },
                "relPosition": {
                  "x": 0,
                  "y": 264
                },
                "id": "PV",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 264,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 490,
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
                  "x": 490,
                  "y": 130
                },
                "relPosition": {
                  "x": 66,
                  "y": 116
                },
                "id": "CV",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 424,
                "y": 50
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
                "x": 490,
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
            "numericId": "2594389",
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
              "id": "ee457285-cd0e-419e-b0e7-e39f9d8e1e46",
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
            "connectedVariables": [],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 66,
          "height": 288,
          "measured": {
            "width": 66,
            "height": 288
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "COIL_87a9567e-cfcc-4ba5-8c9a-7d98fd8b8541",
          "type": "coil",
          "position": {
            "x": 655,
            "y": 38
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 655,
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
                  "x": 683,
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
                  "x": 655,
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
                  "x": 683,
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
                "x": 655,
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
                "x": 683,
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
            "numericId": "6217652",
            "variable": {
              "id": "a4abfbc4-ed48-4f48-9924-9a96cf6566fa",
              "name": "w07_y",
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
          "id": "CONTACT_9dadc48b-44b4-4e1f-b73c-7440fa5a7e62",
          "type": "contact",
          "position": {
            "x": 117,
            "y": 118
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 117,
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
                  "x": 141,
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
                  "x": 117,
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
                  "x": 141,
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
                "x": 117,
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
                "x": 141,
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
            "numericId": "7429380",
            "variable": {
              "id": "a8adeb9b-8bf7-4222-b06a-dabfaaf476a1",
              "name": "w07_i",
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
              "blockId": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
              "handleId": "R",
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
          "id": "PARALLEL_OPEN_27e3a26c-56d3-4a8c-bf1f-39a4964c51de",
          "type": "parallel",
          "position": {
            "x": 68,
            "y": 129
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 68,
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
                  "x": 68,
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
                  "x": 72,
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
                  "x": 72,
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
                  "x": 68,
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
                  "x": 68,
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
                  "x": 72,
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
                  "x": 72,
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
                "x": 68,
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
                "x": 72,
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
            "numericId": "3740653",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 68,
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
                "x": 72,
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
            "parallelCloseReference": "PARALLEL_CLOSE_490ee053-3b19-4073-a3bf-5966fab7f66e",
            "type": "open",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false,
            "branchContext": {
              "blockId": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
              "handleId": "R",
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
          "id": "CONTACT_4ec7b61c-4832-4ad5-baf2-076056fb627c",
          "type": "contact",
          "position": {
            "x": 117,
            "y": 222
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 117,
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
                  "x": 141,
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
                  "x": 117,
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
                  "x": 141,
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
                "x": 117,
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
                "x": 141,
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
            "numericId": "3599964",
            "variable": {
              "id": "529eb4f3-c54b-4a8d-bb27-ccb737561ed5",
              "name": "w07_k",
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
              "blockId": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
              "handleId": "R",
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
          "id": "PARALLEL_CLOSE_490ee053-3b19-4073-a3bf-5966fab7f66e",
          "type": "parallel",
          "position": {
            "x": 300,
            "y": 129
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 300,
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
                  "x": 300,
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
                  "x": 304,
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
                  "x": 304,
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
                  "x": 300,
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
                  "x": 300,
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
                  "x": 304,
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
                  "x": 304,
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
                "x": 300,
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
                "x": 304,
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
            "numericId": "8250764",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 300,
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
                "x": 304,
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
            "parallelOpenReference": "PARALLEL_OPEN_27e3a26c-56d3-4a8c-bf1f-39a4964c51de",
            "type": "close",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false,
            "branchContext": {
              "blockId": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
              "handleId": "R",
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
          "id": "CONTACT_bff7e793-f685-4988-8401-28806028115c",
          "type": "contact",
          "position": {
            "x": 231,
            "y": 118
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 231,
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
                  "x": 255,
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
                  "x": 231,
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
                  "x": 255,
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
                "x": 231,
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
                "x": 255,
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
            "numericId": "1390783",
            "variable": {
              "id": "0cb02094-ccc2-4a13-a193-09b1d33a36f6",
              "name": "w07_j",
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
              "blockId": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
              "handleId": "R",
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
          "id": "right-rail-rung_Blocks_635be45f-5602-4177-b30c-ef155242af49",
          "type": "powerRail",
          "position": {
            "x": 793,
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
                "x": 793
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
            "numericId": "4955468",
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
          "id": "VARIABLE_97af113d-8da1-4100-a3aa-0c1d5cc3dcb2",
          "type": "variable",
          "position": {
            "x": 314,
            "y": 262
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
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 474,
                  "y": 278
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 474,
                  "y": 278
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "outputConnector": {
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "glbPosition": {
                "x": 474,
                "y": 278
              },
              "relPosition": {
                "x": 80,
                "y": 16
              }
            },
            "numericId": "8377465",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
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
          "id": "VARIABLE_7b63700e-96f5-418d-85b0-354db8283058",
          "type": "variable",
          "position": {
            "x": 520,
            "y": 114
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
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "glbPosition": {
                  "x": 520,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                }
              }
            ],
            "inputHandles": [
              {
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "glbPosition": {
                  "x": 520,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                }
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "glbPosition": {
                "x": 520,
                "y": 130
              },
              "relPosition": {
                "x": 0,
                "y": 16
              }
            },
            "numericId": "6745705",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
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
          "id": "e_left-rail-rung_Blocks_635be45f-5602-4177-b30c-ef155242af49_CONTACT_cd537fba-fd59-4970-8cd3-784ff23d49a7__left-rail_input",
          "source": "left-rail-rung_Blocks_635be45f-5602-4177-b30c-ef155242af49",
          "target": "CONTACT_cd537fba-fd59-4970-8cd3-784ff23d49a7",
          "sourceHandle": "left-rail",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_cd537fba-fd59-4970-8cd3-784ff23d49a7_BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79__output_CU",
          "source": "CONTACT_cd537fba-fd59-4970-8cd3-784ff23d49a7",
          "target": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
          "sourceHandle": "output",
          "targetHandle": "CU"
        },
        {
          "id": "e_BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79_COIL_87a9567e-cfcc-4ba5-8c9a-7d98fd8b8541__Q_input",
          "source": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
          "target": "COIL_87a9567e-cfcc-4ba5-8c9a-7d98fd8b8541",
          "sourceHandle": "Q",
          "targetHandle": "input"
        },
        {
          "id": "e_COIL_87a9567e-cfcc-4ba5-8c9a-7d98fd8b8541_right-rail-rung_Blocks_635be45f-5602-4177-b30c-ef155242af49__output_right-rail",
          "source": "COIL_87a9567e-cfcc-4ba5-8c9a-7d98fd8b8541",
          "target": "right-rail-rung_Blocks_635be45f-5602-4177-b30c-ef155242af49",
          "sourceHandle": "output",
          "targetHandle": "right-rail"
        },
        {
          "id": "e_left-rail-rung_Blocks_635be45f-5602-4177-b30c-ef155242af49_PARALLEL_OPEN_27e3a26c-56d3-4a8c-bf1f-39a4964c51de__branch_BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79_R_input",
          "source": "left-rail-rung_Blocks_635be45f-5602-4177-b30c-ef155242af49",
          "target": "PARALLEL_OPEN_27e3a26c-56d3-4a8c-bf1f-39a4964c51de",
          "sourceHandle": "branch_BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79_R",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_27e3a26c-56d3-4a8c-bf1f-39a4964c51de_CONTACT_9dadc48b-44b4-4e1f-b73c-7440fa5a7e62__output-right_input",
          "source": "PARALLEL_OPEN_27e3a26c-56d3-4a8c-bf1f-39a4964c51de",
          "target": "CONTACT_9dadc48b-44b4-4e1f-b73c-7440fa5a7e62",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_27e3a26c-56d3-4a8c-bf1f-39a4964c51de_CONTACT_4ec7b61c-4832-4ad5-baf2-076056fb627c__output-down_input",
          "source": "PARALLEL_OPEN_27e3a26c-56d3-4a8c-bf1f-39a4964c51de",
          "target": "CONTACT_4ec7b61c-4832-4ad5-baf2-076056fb627c",
          "sourceHandle": "output-down",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_4ec7b61c-4832-4ad5-baf2-076056fb627c_PARALLEL_CLOSE_490ee053-3b19-4073-a3bf-5966fab7f66e__output_input-down",
          "source": "CONTACT_4ec7b61c-4832-4ad5-baf2-076056fb627c",
          "target": "PARALLEL_CLOSE_490ee053-3b19-4073-a3bf-5966fab7f66e",
          "sourceHandle": "output",
          "targetHandle": "input-down"
        },
        {
          "id": "e_PARALLEL_CLOSE_490ee053-3b19-4073-a3bf-5966fab7f66e_BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79__output-right_R",
          "source": "PARALLEL_CLOSE_490ee053-3b19-4073-a3bf-5966fab7f66e",
          "target": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
          "sourceHandle": "output-right",
          "targetHandle": "R"
        },
        {
          "id": "e_CONTACT_9dadc48b-44b4-4e1f-b73c-7440fa5a7e62_CONTACT_bff7e793-f685-4988-8401-28806028115c__output_input",
          "source": "CONTACT_9dadc48b-44b4-4e1f-b73c-7440fa5a7e62",
          "target": "CONTACT_bff7e793-f685-4988-8401-28806028115c",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_bff7e793-f685-4988-8401-28806028115c_PARALLEL_CLOSE_490ee053-3b19-4073-a3bf-5966fab7f66e__output_input",
          "source": "CONTACT_bff7e793-f685-4988-8401-28806028115c",
          "target": "PARALLEL_CLOSE_490ee053-3b19-4073-a3bf-5966fab7f66e",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_VARIABLE_97af113d-8da1-4100-a3aa-0c1d5cc3dcb2_BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79__output_PV",
          "source": "VARIABLE_97af113d-8da1-4100-a3aa-0c1d5cc3dcb2",
          "target": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
          "sourceHandle": "output",
          "targetHandle": "PV"
        },
        {
          "id": "e_BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79_VARIABLE_7b63700e-96f5-418d-85b0-354db8283058__CV_input",
          "source": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
          "target": "VARIABLE_7b63700e-96f5-418d-85b0-354db8283058",
          "sourceHandle": "CV",
          "targetHandle": "input"
        }
      ],
      "selectedNodes": [],
      "handleBranches": [
        {
          "blockId": "BLOCK_e3bcbf5d-9f5c-4e49-af77-1eb98cd3fd79",
          "handleId": "R",
          "direction": "input",
          "nodeIds": [
            "PARALLEL_OPEN_27e3a26c-56d3-4a8c-bf1f-39a4964c51de",
            "CONTACT_9dadc48b-44b4-4e1f-b73c-7440fa5a7e62",
            "CONTACT_bff7e793-f685-4988-8401-28806028115c",
            "PARALLEL_CLOSE_490ee053-3b19-4073-a3bf-5966fab7f66e"
          ]
        }
      ]
    },
    {
      "id": "rung_Blocks_88dc3826-bf08-47e4-bba4-0a20dc75c894",
      "comment": "W08 pin-network-three-branches",
      "defaultBounds": [
        300,
        100
      ],
      "reactFlowViewport": [
        796,
        506
      ],
      "nodes": [
        {
          "id": "left-rail-rung_Blocks_88dc3826-bf08-47e4-bba4-0a20dc75c894",
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
                  "y": 210
                },
                "relPosition": {
                  "x": 3,
                  "y": 180
                },
                "id": "branch_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c_LD",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 180,
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
                  "y": 210
                },
                "relPosition": {
                  "x": 3,
                  "y": 180
                },
                "id": "branch_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c_LD",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 180,
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
            "numericId": "6443221",
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
          "id": "CONTACT_5322d3a5-1e48-46a4-b679-f691547139b1",
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
            "numericId": "8352936",
            "variable": {
              "id": "c1547b55-422d-40f0-acae-b1958e9dbc6c",
              "name": "w08_c",
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
          "id": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "type": "block",
          "position": {
            "x": 424,
            "y": 14
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 424,
                  "y": 50
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
                  "x": 424,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "CD",
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
                  "x": 424,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "R",
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
                  "x": 424,
                  "y": 210
                },
                "relPosition": {
                  "x": 0,
                  "y": 196
                },
                "id": "LD",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 196,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 424,
                  "y": 462
                },
                "relPosition": {
                  "x": 0,
                  "y": 448
                },
                "id": "PV",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 448,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 490,
                  "y": 50
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "QU",
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
                  "x": 490,
                  "y": 90
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "QD",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 490,
                  "y": 130
                },
                "relPosition": {
                  "x": 66,
                  "y": 116
                },
                "id": "CV",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "right": 0
                }
              }
            ],
            "inputHandles": [
              {
                "glbPosition": {
                  "x": 424,
                  "y": 50
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
                  "x": 424,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 76
                },
                "id": "CD",
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
                  "x": 424,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 116
                },
                "id": "R",
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
                  "x": 424,
                  "y": 210
                },
                "relPosition": {
                  "x": 0,
                  "y": 196
                },
                "id": "LD",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 196,
                  "left": 0
                }
              },
              {
                "glbPosition": {
                  "x": 424,
                  "y": 462
                },
                "relPosition": {
                  "x": 0,
                  "y": 448
                },
                "id": "PV",
                "position": "left",
                "type": "target",
                "isConnectable": false,
                "style": {
                  "top": 448,
                  "left": 0
                }
              }
            ],
            "outputHandles": [
              {
                "glbPosition": {
                  "x": 490,
                  "y": 50
                },
                "relPosition": {
                  "x": 66,
                  "y": 36
                },
                "id": "QU",
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
                  "x": 490,
                  "y": 90
                },
                "relPosition": {
                  "x": 66,
                  "y": 76
                },
                "id": "QD",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 76,
                  "right": 0
                }
              },
              {
                "glbPosition": {
                  "x": 490,
                  "y": 130
                },
                "relPosition": {
                  "x": 66,
                  "y": 116
                },
                "id": "CV",
                "position": "right",
                "type": "source",
                "isConnectable": false,
                "style": {
                  "top": 116,
                  "right": 0
                }
              }
            ],
            "inputConnector": {
              "glbPosition": {
                "x": 424,
                "y": 50
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
                "x": 490,
                "y": 50
              },
              "relPosition": {
                "x": 66,
                "y": 36
              },
              "id": "QU",
              "position": "right",
              "type": "source",
              "isConnectable": false,
              "style": {
                "top": 36,
                "right": 0
              }
            },
            "numericId": "2041751",
            "variant": {
              "name": "CTUD",
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
                  "name": "CD",
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
                  "name": "LD",
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
                  "name": "QU",
                  "class": "output",
                  "type": {
                    "definition": "base-type",
                    "value": "BOOL"
                  }
                },
                {
                  "name": "QD",
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
              "documentation": "The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.",
              "extensible": false
            },
            "variable": {
              "id": "f72d1d4a-8f15-47df-b739-6355052cca06",
              "name": "CTUD0",
              "type": {
                "definition": "derived",
                "value": "CTUD"
              },
              "class": "local",
              "location": "",
              "documentation": "",
              "debug": false
            },
            "executionOrder": 0,
            "executionControl": false,
            "lockExecutionControl": false,
            "connectedVariables": [],
            "draggable": true,
            "selectable": true,
            "deletable": true
          },
          "width": 66,
          "height": 472,
          "measured": {
            "width": 66,
            "height": 472
          },
          "draggable": true,
          "selectable": true,
          "selected": false,
          "dragging": false
        },
        {
          "id": "COIL_4185b63d-294b-478d-8c0e-0d4b3f23e978",
          "type": "coil",
          "position": {
            "x": 655,
            "y": 38
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 655,
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
                  "x": 683,
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
                  "x": 655,
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
                  "x": 683,
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
                "x": 655,
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
                "x": 683,
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
            "numericId": "5454758",
            "variable": {
              "id": "cda921d5-141f-475d-8000-af9ca280d93d",
              "name": "w08_y",
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
          "id": "CONTACT_f0b62464-b9bb-4f17-a231-9396ee078220",
          "type": "contact",
          "position": {
            "x": 117,
            "y": 198
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 117,
                  "y": 210
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
                  "x": 141,
                  "y": 210
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
                  "x": 117,
                  "y": 210
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
                  "x": 141,
                  "y": 210
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
                "x": 117,
                "y": 210
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
                "x": 141,
                "y": 210
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
            "numericId": "8687540",
            "variable": {
              "id": "fd8401d4-dcf5-4420-8629-d213bba29e3c",
              "name": "w08_i",
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
              "blockId": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "LD",
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
          "id": "PARALLEL_OPEN_be161795-c79d-4ee7-b10f-1df624b726ba",
          "type": "parallel",
          "position": {
            "x": 68,
            "y": 209
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 68,
                  "y": 210
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
                  "x": 68,
                  "y": 210
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
                  "x": 72,
                  "y": 210
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
                  "x": 72,
                  "y": 210
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
                  "x": 68,
                  "y": 210
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
                  "x": 68,
                  "y": 210
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
                  "x": 72,
                  "y": 210
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
                  "x": 72,
                  "y": 210
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
                "x": 68,
                "y": 210
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
                "x": 72,
                "y": 210
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
            "numericId": "3527489",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 68,
                "y": 210
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
                "x": 72,
                "y": 210
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
            "parallelCloseReference": "PARALLEL_CLOSE_bd3b966e-e71f-4957-a996-f5dc5d87852b",
            "type": "open",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false,
            "branchContext": {
              "blockId": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "LD",
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
          "id": "CONTACT_a8b56f82-2b2d-4336-829f-5203c131111b",
          "type": "contact",
          "position": {
            "x": 117,
            "y": 302
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 117,
                  "y": 314
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
                  "x": 141,
                  "y": 314
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
                  "x": 117,
                  "y": 314
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
                  "x": 141,
                  "y": 314
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
                "x": 117,
                "y": 314
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
                "x": 141,
                "y": 314
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
            "numericId": "3730732",
            "variable": {
              "id": "1b811b1b-5e98-4ad8-b743-8554756b3ff5",
              "name": "w08_k",
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
              "blockId": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "LD",
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
          "id": "PARALLEL_CLOSE_bd3b966e-e71f-4957-a996-f5dc5d87852b",
          "type": "parallel",
          "position": {
            "x": 300,
            "y": 209
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 300,
                  "y": 210
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
                  "x": 300,
                  "y": 210
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
                  "x": 304,
                  "y": 210
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
                  "x": 304,
                  "y": 210
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
                  "x": 300,
                  "y": 210
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
                  "x": 300,
                  "y": 210
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
                  "x": 304,
                  "y": 210
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
                  "x": 304,
                  "y": 210
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
                "x": 300,
                "y": 210
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
                "x": 304,
                "y": 210
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
            "numericId": "74382",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 300,
                "y": 210
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
                "x": 304,
                "y": 210
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
            "parallelOpenReference": "PARALLEL_OPEN_be161795-c79d-4ee7-b10f-1df624b726ba",
            "type": "close",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false,
            "branchContext": {
              "blockId": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "LD",
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
          "id": "PARALLEL_OPEN_715b3227-be6a-41b2-b59b-a5d800d35820",
          "type": "parallel",
          "position": {
            "x": 68,
            "y": 313
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 68,
                  "y": 314
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
                  "x": 68,
                  "y": 314
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
                  "x": 72,
                  "y": 314
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
                  "x": 72,
                  "y": 314
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
                  "x": 68,
                  "y": 314
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
                  "x": 68,
                  "y": 314
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
                  "x": 72,
                  "y": 314
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
                  "x": 72,
                  "y": 314
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
                "x": 68,
                "y": 314
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
                "x": 72,
                "y": 314
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
            "numericId": "7509839",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 68,
                "y": 314
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
                "x": 72,
                "y": 314
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
            "parallelCloseReference": "PARALLEL_CLOSE_3e43e547-79a4-4e8a-8354-c441e8cdadc0",
            "type": "open",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false,
            "branchContext": {
              "blockId": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "LD",
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
          "id": "CONTACT_049648bb-ca68-4c07-80c3-eda9a859f32a",
          "type": "contact",
          "position": {
            "x": 117,
            "y": 406
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 117,
                  "y": 418
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
                  "x": 141,
                  "y": 418
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
                  "x": 117,
                  "y": 418
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
                  "x": 141,
                  "y": 418
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
                "x": 117,
                "y": 418
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
                "x": 141,
                "y": 418
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
            "numericId": "6966087",
            "variable": {
              "id": "c4a1fae1-c7d0-481b-8dd3-d282eafe41e7",
              "name": "w08_l",
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
              "blockId": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "LD",
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
          "id": "PARALLEL_CLOSE_3e43e547-79a4-4e8a-8354-c441e8cdadc0",
          "type": "parallel",
          "position": {
            "x": 186,
            "y": 313
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 186,
                  "y": 314
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
                  "x": 186,
                  "y": 314
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
                  "x": 190,
                  "y": 314
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
                  "x": 190,
                  "y": 314
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
                  "x": 186,
                  "y": 314
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
                  "x": 186,
                  "y": 314
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
                  "x": 190,
                  "y": 314
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
                  "x": 190,
                  "y": 314
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
                "x": 186,
                "y": 314
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
                "x": 190,
                "y": 314
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
            "numericId": "5104752",
            "parallelInputConnector": {
              "glbPosition": {
                "x": 186,
                "y": 314
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
                "x": 190,
                "y": 314
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
            "parallelOpenReference": "PARALLEL_OPEN_715b3227-be6a-41b2-b59b-a5d800d35820",
            "type": "close",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "draggable": false,
            "selectable": false,
            "deletable": false,
            "branchContext": {
              "blockId": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "LD",
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
          "id": "CONTACT_69ef7cf6-e620-48ac-944e-b56a30c0e469",
          "type": "contact",
          "position": {
            "x": 231,
            "y": 198
          },
          "data": {
            "handles": [
              {
                "glbPosition": {
                  "x": 231,
                  "y": 210
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
                  "x": 255,
                  "y": 210
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
                  "x": 231,
                  "y": 210
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
                  "x": 255,
                  "y": 210
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
                "x": 231,
                "y": 210
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
                "x": 255,
                "y": 210
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
            "numericId": "626126",
            "variable": {
              "id": "2755ddd3-e792-4608-914c-95a2cf6deec2",
              "name": "w08_j",
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
              "blockId": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "LD",
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
          "id": "right-rail-rung_Blocks_88dc3826-bf08-47e4-bba4-0a20dc75c894",
          "type": "powerRail",
          "position": {
            "x": 793,
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
                "x": 793
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
            "numericId": "6411695",
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
          "id": "VARIABLE_786c3b0a-c037-45a2-8d30-e6bf74a1c764",
          "type": "variable",
          "position": {
            "x": 314,
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
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 474,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 474,
                  "y": 90
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "outputConnector": {
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "glbPosition": {
                "x": 474,
                "y": 90
              },
              "relPosition": {
                "x": 80,
                "y": 16
              }
            },
            "numericId": "6507719",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "CD",
              "variableType": {
                "name": "CD",
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
          "id": "VARIABLE_b59b76de-bd32-48ab-912c-d85f46a25941",
          "type": "variable",
          "position": {
            "x": 314,
            "y": 114
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
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 474,
                  "y": 130
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 474,
                  "y": 130
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "outputConnector": {
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "glbPosition": {
                "x": 474,
                "y": 130
              },
              "relPosition": {
                "x": 80,
                "y": 16
              }
            },
            "numericId": "1981412",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
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
          "id": "VARIABLE_d03fdb00-1ea9-4772-a231-dccdde31803f",
          "type": "variable",
          "position": {
            "x": 314,
            "y": 446
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
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 474,
                  "y": 462
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "inputHandles": [],
            "outputHandles": [
              {
                "id": "output",
                "position": "right",
                "isConnectable": false,
                "type": "source",
                "glbPosition": {
                  "x": 474,
                  "y": 462
                },
                "relPosition": {
                  "x": 80,
                  "y": 16
                }
              }
            ],
            "outputConnector": {
              "id": "output",
              "position": "right",
              "isConnectable": false,
              "type": "source",
              "glbPosition": {
                "x": 474,
                "y": 462
              },
              "relPosition": {
                "x": 80,
                "y": 16
              }
            },
            "numericId": "8696969",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "input",
            "block": {
              "id": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
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
          "id": "VARIABLE_a65c42f0-7ccf-45cf-a71e-f3976571d3d1",
          "type": "variable",
          "position": {
            "x": 520,
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
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "glbPosition": {
                  "x": 520,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                }
              }
            ],
            "inputHandles": [
              {
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "glbPosition": {
                  "x": 520,
                  "y": 90
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                }
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "glbPosition": {
                "x": 520,
                "y": 90
              },
              "relPosition": {
                "x": 0,
                "y": 16
              }
            },
            "numericId": "6688067",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
              "handleId": "QD",
              "variableType": {
                "name": "QD",
                "class": "output",
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
          "id": "VARIABLE_6dcf3821-6136-4c84-8220-f55f0d8ed809",
          "type": "variable",
          "position": {
            "x": 520,
            "y": 114
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
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "glbPosition": {
                  "x": 520,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                }
              }
            ],
            "inputHandles": [
              {
                "id": "input",
                "position": "left",
                "isConnectable": false,
                "type": "target",
                "glbPosition": {
                  "x": 520,
                  "y": 130
                },
                "relPosition": {
                  "x": 0,
                  "y": 16
                }
              }
            ],
            "outputHandles": [],
            "inputConnector": {
              "id": "input",
              "position": "left",
              "isConnectable": false,
              "type": "target",
              "glbPosition": {
                "x": 520,
                "y": 130
              },
              "relPosition": {
                "x": 0,
                "y": 16
              }
            },
            "numericId": "9353736",
            "variable": {
              "name": ""
            },
            "executionOrder": 0,
            "variant": "output",
            "block": {
              "id": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
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
          "id": "e_left-rail-rung_Blocks_88dc3826-bf08-47e4-bba4-0a20dc75c894_CONTACT_5322d3a5-1e48-46a4-b679-f691547139b1__left-rail_input",
          "source": "left-rail-rung_Blocks_88dc3826-bf08-47e4-bba4-0a20dc75c894",
          "target": "CONTACT_5322d3a5-1e48-46a4-b679-f691547139b1",
          "sourceHandle": "left-rail",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_5322d3a5-1e48-46a4-b679-f691547139b1_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c__output_CU",
          "source": "CONTACT_5322d3a5-1e48-46a4-b679-f691547139b1",
          "target": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "sourceHandle": "output",
          "targetHandle": "CU"
        },
        {
          "id": "e_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c_COIL_4185b63d-294b-478d-8c0e-0d4b3f23e978__QU_input",
          "source": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "target": "COIL_4185b63d-294b-478d-8c0e-0d4b3f23e978",
          "sourceHandle": "QU",
          "targetHandle": "input"
        },
        {
          "id": "e_COIL_4185b63d-294b-478d-8c0e-0d4b3f23e978_right-rail-rung_Blocks_88dc3826-bf08-47e4-bba4-0a20dc75c894__output_right-rail",
          "source": "COIL_4185b63d-294b-478d-8c0e-0d4b3f23e978",
          "target": "right-rail-rung_Blocks_88dc3826-bf08-47e4-bba4-0a20dc75c894",
          "sourceHandle": "output",
          "targetHandle": "right-rail"
        },
        {
          "id": "e_left-rail-rung_Blocks_88dc3826-bf08-47e4-bba4-0a20dc75c894_PARALLEL_OPEN_be161795-c79d-4ee7-b10f-1df624b726ba__branch_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c_LD_input",
          "source": "left-rail-rung_Blocks_88dc3826-bf08-47e4-bba4-0a20dc75c894",
          "target": "PARALLEL_OPEN_be161795-c79d-4ee7-b10f-1df624b726ba",
          "sourceHandle": "branch_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c_LD",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_be161795-c79d-4ee7-b10f-1df624b726ba_CONTACT_f0b62464-b9bb-4f17-a231-9396ee078220__output-right_input",
          "source": "PARALLEL_OPEN_be161795-c79d-4ee7-b10f-1df624b726ba",
          "target": "CONTACT_f0b62464-b9bb-4f17-a231-9396ee078220",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_CLOSE_bd3b966e-e71f-4957-a996-f5dc5d87852b_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c__output-right_LD",
          "source": "PARALLEL_CLOSE_bd3b966e-e71f-4957-a996-f5dc5d87852b",
          "target": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "sourceHandle": "output-right",
          "targetHandle": "LD"
        },
        {
          "id": "e_PARALLEL_OPEN_be161795-c79d-4ee7-b10f-1df624b726ba_PARALLEL_OPEN_715b3227-be6a-41b2-b59b-a5d800d35820__output-down_input-top",
          "source": "PARALLEL_OPEN_be161795-c79d-4ee7-b10f-1df624b726ba",
          "target": "PARALLEL_OPEN_715b3227-be6a-41b2-b59b-a5d800d35820",
          "sourceHandle": "output-down",
          "targetHandle": "input-top"
        },
        {
          "id": "e_PARALLEL_OPEN_715b3227-be6a-41b2-b59b-a5d800d35820_CONTACT_a8b56f82-2b2d-4336-829f-5203c131111b__output-right_input",
          "source": "PARALLEL_OPEN_715b3227-be6a-41b2-b59b-a5d800d35820",
          "target": "CONTACT_a8b56f82-2b2d-4336-829f-5203c131111b",
          "sourceHandle": "output-right",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_a8b56f82-2b2d-4336-829f-5203c131111b_PARALLEL_CLOSE_3e43e547-79a4-4e8a-8354-c441e8cdadc0__output_input",
          "source": "CONTACT_a8b56f82-2b2d-4336-829f-5203c131111b",
          "target": "PARALLEL_CLOSE_3e43e547-79a4-4e8a-8354-c441e8cdadc0",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_PARALLEL_OPEN_715b3227-be6a-41b2-b59b-a5d800d35820_CONTACT_049648bb-ca68-4c07-80c3-eda9a859f32a__output-down_input",
          "source": "PARALLEL_OPEN_715b3227-be6a-41b2-b59b-a5d800d35820",
          "target": "CONTACT_049648bb-ca68-4c07-80c3-eda9a859f32a",
          "sourceHandle": "output-down",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_049648bb-ca68-4c07-80c3-eda9a859f32a_PARALLEL_CLOSE_3e43e547-79a4-4e8a-8354-c441e8cdadc0__output_input-down",
          "source": "CONTACT_049648bb-ca68-4c07-80c3-eda9a859f32a",
          "target": "PARALLEL_CLOSE_3e43e547-79a4-4e8a-8354-c441e8cdadc0",
          "sourceHandle": "output",
          "targetHandle": "input-down"
        },
        {
          "id": "e_PARALLEL_CLOSE_3e43e547-79a4-4e8a-8354-c441e8cdadc0_PARALLEL_CLOSE_bd3b966e-e71f-4957-a996-f5dc5d87852b__output-top_input-down",
          "source": "PARALLEL_CLOSE_3e43e547-79a4-4e8a-8354-c441e8cdadc0",
          "target": "PARALLEL_CLOSE_bd3b966e-e71f-4957-a996-f5dc5d87852b",
          "sourceHandle": "output-top",
          "targetHandle": "input-down"
        },
        {
          "id": "e_CONTACT_f0b62464-b9bb-4f17-a231-9396ee078220_CONTACT_69ef7cf6-e620-48ac-944e-b56a30c0e469__output_input",
          "source": "CONTACT_f0b62464-b9bb-4f17-a231-9396ee078220",
          "target": "CONTACT_69ef7cf6-e620-48ac-944e-b56a30c0e469",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_CONTACT_69ef7cf6-e620-48ac-944e-b56a30c0e469_PARALLEL_CLOSE_bd3b966e-e71f-4957-a996-f5dc5d87852b__output_input",
          "source": "CONTACT_69ef7cf6-e620-48ac-944e-b56a30c0e469",
          "target": "PARALLEL_CLOSE_bd3b966e-e71f-4957-a996-f5dc5d87852b",
          "sourceHandle": "output",
          "targetHandle": "input"
        },
        {
          "id": "e_VARIABLE_786c3b0a-c037-45a2-8d30-e6bf74a1c764_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c__output_CD",
          "source": "VARIABLE_786c3b0a-c037-45a2-8d30-e6bf74a1c764",
          "target": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "sourceHandle": "output",
          "targetHandle": "CD"
        },
        {
          "id": "e_VARIABLE_b59b76de-bd32-48ab-912c-d85f46a25941_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c__output_R",
          "source": "VARIABLE_b59b76de-bd32-48ab-912c-d85f46a25941",
          "target": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "sourceHandle": "output",
          "targetHandle": "R"
        },
        {
          "id": "e_VARIABLE_d03fdb00-1ea9-4772-a231-dccdde31803f_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c__output_PV",
          "source": "VARIABLE_d03fdb00-1ea9-4772-a231-dccdde31803f",
          "target": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "sourceHandle": "output",
          "targetHandle": "PV"
        },
        {
          "id": "e_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c_VARIABLE_a65c42f0-7ccf-45cf-a71e-f3976571d3d1__QD_input",
          "source": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "target": "VARIABLE_a65c42f0-7ccf-45cf-a71e-f3976571d3d1",
          "sourceHandle": "QD",
          "targetHandle": "input"
        },
        {
          "id": "e_BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c_VARIABLE_6dcf3821-6136-4c84-8220-f55f0d8ed809__CV_input",
          "source": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "target": "VARIABLE_6dcf3821-6136-4c84-8220-f55f0d8ed809",
          "sourceHandle": "CV",
          "targetHandle": "input"
        }
      ],
      "selectedNodes": [],
      "handleBranches": [
        {
          "blockId": "BLOCK_91ebd3f3-178c-4553-8df1-092eeb9f1a5c",
          "handleId": "LD",
          "direction": "input",
          "nodeIds": [
            "PARALLEL_OPEN_be161795-c79d-4ee7-b10f-1df624b726ba",
            "CONTACT_f0b62464-b9bb-4f17-a231-9396ee078220",
            "CONTACT_69ef7cf6-e620-48ac-944e-b56a30c0e469",
            "PARALLEL_CLOSE_bd3b966e-e71f-4957-a996-f5dc5d87852b"
          ]
        }
      ]
    }
  ]
}
END_PROGRAM