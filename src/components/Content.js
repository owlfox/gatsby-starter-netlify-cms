import React from "react";
import PropTypes from "prop-types";
import './postcontent.sass'

export const HTMLContent = ({ content, className }) => {
  const defaults = `is-large`
  const classes = className ? defaults + className : defaults;
  return (
    <div className={classes} dangerouslySetInnerHTML={{ __html: content }} />
  );
};

const Content = ({ content, className }) => (
  <div className={className}>{content}</div>
);

Content.propTypes = {
  content: PropTypes.node,
  className: PropTypes.string
};

HTMLContent.propTypes = Content.propTypes;

export default Content;
