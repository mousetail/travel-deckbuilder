import "./style.css";
import { requireElementById } from "./ui/dom";
import { App } from "./ui/app";

const root = requireElementById("app", HTMLDivElement);
const app = new App(root);
app.mount();