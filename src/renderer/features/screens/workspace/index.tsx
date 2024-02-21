import { ContainerComponent, PanelsGroupComponent } from "./components";
import Activitybar from "./components/activitybar";

export default function Workspace() {
  return (
    <ContainerComponent>
      <Activitybar />
      {/** Here goes the activity component */}
      <PanelsGroupComponent />
    </ContainerComponent>
  );
}
