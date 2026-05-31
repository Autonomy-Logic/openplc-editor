# OpenPLC Ladder Interface Guide

This guide provides comprehensive documentation for the OpenPLC Ladder programming interface to help users navigate the UI and write simple ladder algorithms.

## Interface Overview

The Ladder interface in OpenPLC Editor provides a visual programming environment similar to traditional PLC ladder logic programming. The interface consists of several key components:

### Main Toolbar
- **New Program**: Create a new ladder program
- **Open**: Load an existing ladder program
- **Save**: Save the current program
- **Compile**: Compile the ladder logic for simulation
- **Download**: Transfer program to OpenPLC Runtime

### Program Editor Area
- **Rung Editor**: Each horizontal line represents a logic rung
- **Instruction Palette**: Drag-and-drop ladder instructions
- **Variable Panel**: Manage input/output variables and memory
- **Properties Panel**: View and edit instruction properties

## Basic Ladder Instructions

### Input Instructions
- **XIC (Examine If Closed)**: Normally open contact
- **XIO (Examine If Open)**: Normally closed contact

### Output Instructions
- **OTE (Output Energize)**: Standard coil output
- **OTL (Output Latch)**: Latching coil
- **OTU (Output Unlatch)**: Unlatching coil

### Timer Instructions
- **TON (Timer On Delay)**: Delays output activation
- **TOF (Timer Off Delay)**: Delays output deactivation
- **RTO (Retentive Timer)**: Maintains elapsed time

### Counter Instructions
- **CTU (Count Up)**: Increments on each transition
- **CTD (Count Down)**: Decrements on each transition
- **RES (Reset)**: Resets counter to zero

## Getting Started

1. **Create New Program**: Click "New Program" in the toolbar
2. **Add Rungs**: Right-click in editor area and select "Add Rung"
3. **Insert Instructions**: Drag instructions from palette to rungs
4. **Configure Variables**: Define variables in the variable panel
5. **Compile**: Click "Compile" to check for errors
6. **Test**: Use simulation mode to verify logic

## Example Program

```
Rung 1:
|--[XIC Input1]--[TON Timer1]--(OTE Output1)--|

Rung 2:
|--[XIO Input2]--[CTU Counter1]--(OTE Output2)--|
```

This example shows a timer-controlled output and a counter-controlled output.

## Best Practices

- **Label Variables Clearly**: Use descriptive names for inputs, outputs, and memory
- **Comment Complex Logic**: Add comments to explain non-obvious logic
- **Organize Rungs Logically**: Group related functions together
- **Test Incrementally**: Compile and test after adding each section
- **Use Error Handling**: Implement proper error checking and handling

## Troubleshooting

### Common Issues
- **Compilation Errors**: Check instruction syntax and variable definitions
- **Logic Not Working**: Verify rung continuity and instruction placement
- **Timing Issues**: Review timer presets and base time settings

### Debugging Tips
1. Use the simulation mode to step through logic
2. Monitor variable values in real-time
3. Check for proper instruction sequencing
4. Verify all connections are properly made

## Advanced Features

### Subroutines
- Create reusable logic blocks
- Pass parameters between main program and subroutines
- Improve program organization and maintainability

### Data Handling
- Move data between variables
- Perform mathematical operations
- Compare values for conditional logic

For more detailed information about specific instructions and advanced programming techniques, refer to the official IEC 61131-3 standard documentation.