import './index.less';

export const LogoUrl =
  'https://lf3-static.bytednsdoc.com/obj/eden-cn/vhaeh7vhabf/Midscene.png';

export const Logo = ({ hideLogo = false }: { hideLogo?: boolean }) => {
  if (hideLogo) {
    return null;
  }

  return (
    <div className="logo">
      <img
        alt="Pattern Hunter Logo"
        src="https://lf3-static.bytednsdoc.com/obj/eden-cn/vhaeh7vhabf/Midscene.png"
      />
    </div>
  );
};
